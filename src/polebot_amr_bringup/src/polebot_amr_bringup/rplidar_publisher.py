#!/usr/bin/env python3
"""
rplidar_publisher.py  (v3 - Express Scan)
==========================================
Node ROS 2 Python qui lit le RPLidar A1 en mode Express Scan.

Le firmware v1.28 renvoie distance=0 en mode Standard Scan (0x20).
Le mode Express Scan (0x82, aka "Sensitivity") fonctionne correctement
et fournit des mesures a 8 kHz.

Protocole Express Scan :
  - Commande : A5 82 05 00 00 00 00 00 22
  - Reponse  : capsules de 84 octets (16 cabins x 2 mesures = 32 pts)
  - Angles   : interpoles entre start_angle de 2 capsules consecutives
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan
import serial
import struct
import math
import time

CMD_STOP = b'\xa5\x25'
CMD_GET_HEALTH = b'\xa5\x52'
# Express Scan: cmd=0x82, payload_len=5, payload=00*5, checksum=0x22
CMD_EXPRESS_SCAN = b'\xa5\x82\x05\x00\x00\x00\x00\x00\x22'

CAPSULE_SIZE = 84
SYNC1 = 0x0A
SYNC2 = 0x05


class RplidarPublisher(Node):

    def __init__(self):
        super().__init__('rplidar_publisher')
        self.declare_parameter('serial_port', '/dev/ttyUSB0')
        self.declare_parameter('frame_id', 'laser')
        self.declare_parameter('range_max', 12.0)

        port = self.get_parameter('serial_port').value
        self.frame_id = self.get_parameter('frame_id').value
        self.range_max = self.get_parameter('range_max').value

        self.pub = self.create_publisher(LaserScan, '/scan', 10)

        try:
            self.ser = serial.Serial(port, 115200, timeout=0.05)
        except serial.SerialException as e:
            self.get_logger().fatal(f'Impossible d\'ouvrir {port}: {e}')
            raise SystemExit(1)

        # DTR=False = moteur ON (CP2102 + RPLidar A1)
        self.ser.setDTR(True)
        time.sleep(0.3)
        self.ser.setDTR(False)
        self.get_logger().info('Moteur demarre, attente 2s...')
        time.sleep(2.0)
        self.ser.reset_input_buffer()

        # Verification sante
        self.ser.write(CMD_GET_HEALTH)
        time.sleep(0.15)
        health = self.ser.read(10)
        if len(health) >= 10 and health[7] == 0:
            self.get_logger().info('LiDAR sante : OK')
        else:
            self.get_logger().warn(
                f'Reponse sante inattendue : {health.hex() if health else "vide"}')

        # Demarrer Express Scan
        self.ser.reset_input_buffer()
        self.ser.write(CMD_EXPRESS_SCAN)
        time.sleep(0.2)
        descriptor = self.ser.read(7)
        self.get_logger().info(f'Express Scan demarre (desc: {descriptor.hex()})')

        # Buffer et etat
        self._buf = bytearray()
        self._prev_start_angle = None
        self._prev_distances = None
        self._scan_data = {}  # angle_deg -> distance_m

        self.create_timer(0.05, self.read_capsules)
        self.get_logger().info('RPLidar publisher pret (Express Scan)')

    def read_capsules(self):
        """Lit les capsules Express Scan de 84 octets."""
        try:
            avail = self.ser.in_waiting
            if avail > 0:
                self._buf.extend(self.ser.read(min(avail, 4096)))
        except serial.SerialException as e:
            self.get_logger().error(f'Erreur port serie: {e}')
            self._reconnect()
            return

        while len(self._buf) >= CAPSULE_SIZE:
            # Verifier sync bytes
            s1 = (self._buf[0] >> 4) & 0x0F
            s2 = (self._buf[1] >> 4) & 0x0F

            if s1 != SYNC1 or s2 != SYNC2:
                del self._buf[0]
                continue

            capsule = bytes(self._buf[:CAPSULE_SIZE])
            del self._buf[:CAPSULE_SIZE]
            self._process_capsule(capsule)

    def _process_capsule(self, cap):
        """Decode une capsule Express Scan (84 octets -> 32 mesures)."""
        start_angle_raw = struct.unpack_from('<H', cap, 2)[0]
        new_scan = bool(start_angle_raw & 0x8000)
        start_angle_deg = (start_angle_raw & 0x7FFF) / 64.0

        # Extraire les 32 distances (16 cabins x 2)
        distances = []
        for i in range(16):
            off = 4 + i * 5
            d1 = struct.unpack_from('<H', cap, off)[0]
            d2 = struct.unpack_from('<H', cap, off + 2)[0]
            distances.append(d1 / 4.0)  # mm
            distances.append(d2 / 4.0)  # mm

        if self._prev_start_angle is not None and self._prev_distances is not None:
            # Calculer l'increment angulaire entre les 2 capsules
            diff = start_angle_deg - self._prev_start_angle
            if diff < 0:
                diff += 360.0
            angle_inc = diff / 32.0

            for idx, dist_mm in enumerate(self._prev_distances):
                angle_deg = (self._prev_start_angle + idx * angle_inc) % 360.0
                dist_m = dist_mm / 1000.0

                if 0.15 <= dist_m <= self.range_max:
                    angle_idx = int(round(angle_deg)) % 360
                    self._scan_data[angle_idx] = dist_m

        # Nouvelle revolution -> publier
        if new_scan and self._scan_data:
            self._publish_scan()
            self._scan_data = {}

        self._prev_start_angle = start_angle_deg
        self._prev_distances = distances

    def _publish_scan(self):
        if not self._scan_data:
            return

        msg = LaserScan()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = self.frame_id
        msg.angle_min = 0.0
        msg.angle_max = 2 * math.pi
        msg.angle_increment = math.radians(1.0)
        msg.scan_time = 0.15
        msg.time_increment = msg.scan_time / 360.0
        msg.range_min = 0.15
        msg.range_max = self.range_max

        ranges = [float('inf')] * 360
        for idx, dist in self._scan_data.items():
            ranges[idx] = dist

        msg.ranges = ranges
        self.pub.publish(msg)
        self.get_logger().info(
            f'Scan publie : {len(self._scan_data)} points',
            throttle_duration_sec=2.0)

    def _reconnect(self):
        self.get_logger().warn('Tentative de reconnexion dans 3s...')
        time.sleep(3.0)
        try:
            self.ser.close()
            time.sleep(1.0)
            self.ser.open()
            self.ser.setDTR(True)
            time.sleep(0.3)
            self.ser.setDTR(False)
            time.sleep(2.0)
            self.ser.reset_input_buffer()
            self._buf.clear()
            self.ser.write(CMD_EXPRESS_SCAN)
            time.sleep(0.2)
            self.ser.read(7)
            self.get_logger().info('Reconnexion reussie !')
        except Exception as e:
            self.get_logger().error(f'Reconnexion echouee : {e}')

    def destroy_node(self):
        if self.ser.is_open:
            self.ser.write(CMD_STOP)
            time.sleep(0.1)
            self.ser.setDTR(True)
            self.ser.close()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = RplidarPublisher()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
