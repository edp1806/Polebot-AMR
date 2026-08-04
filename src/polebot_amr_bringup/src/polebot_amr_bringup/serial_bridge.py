#!/usr/bin/env python3
"""
serial_bridge.py — Node unifie pour le robot Polebot physique
==============================================================
Remplace cmd_to_serial_v2.py + encoder_node.py en un seul node.

PROBLEME RESOLU : cmd_to_serial_v2.py et encoder_node.py ouvraient
tous les deux /dev/ttyACM0 (a des baud rates differents), ce qui
causait un conflit de port.

Ce node ouvre le port UNE SEULE FOIS et gere les deux directions :

  ROS → Arduino : envoi des commandes /cmd_vel (meme logique que cmd_to_serial_v2.py)
  Arduino → ROS : lecture des encodeurs "L:XXX R:XXX" → publication /odom + TF

PROTOCOLE ARDUINO (a verifier avec votre firmware) :
  Reception  : "V:0.500,0.300\n"  (ou le format actuel de cmd_to_serial)
  Emission   : "L:1234 R:5678\n"  (format confirme par encoder_node.py)

PARAMETRES MECANIQUES (a ajuster selon le vrai robot) :
  TICKS_PER_REV = 134   (lu dans encoder_node.py existant)
  WHEEL_DIAMETER = 0.10  (lu dans encoder_node.py existant)
  WHEEL_BASE     = 0.30  (lu dans encoder_node.py existant)
"""

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist, TransformStamped
from nav_msgs.msg import Odometry
from tf2_ros import TransformBroadcaster

import serial
import threading
import math
import time

# ============================================================
#  Constantes mecaniques du robot (copiees de encoder_node.py)
# ============================================================
TICKS_PER_REV  = 134
WHEEL_DIAMETER = 0.10
WHEEL_BASE     = 0.30
WHEEL_CIRC     = math.pi * WHEEL_DIAMETER   # circonference d'une roue


class SerialBridgeNode(Node):

    def __init__(self):
        super().__init__('serial_bridge')

        # ---- Parameters ----
        self.declare_parameter('serial_port',  '/dev/ttyACM0')
        self.declare_parameter('baudrate',     115200)   # meme baud que cmd_to_serial_v2.py
        self.declare_parameter('base_frame',   'base_link')
        self.declare_parameter('odom_frame',   'odom')

        port            = self.get_parameter('serial_port').value
        baud            = self.get_parameter('baudrate').value
        self.base_frame = self.get_parameter('base_frame').value
        self.odom_frame = self.get_parameter('odom_frame').value

        # ---- Ouverture UNIQUE du port serie ----
        try:
            self.ser = serial.Serial(port, baud, timeout=0.1)
            self.get_logger().info(f'Port {port} ouvert a {baud} baud.')
        except serial.SerialException as e:
            self.get_logger().fatal(f'Impossible d\'ouvrir {port}: {e}')
            raise SystemExit(1)

        # ---- Publishers / Subscribers ----
        self.odom_pub       = self.create_publisher(Odometry, '/odom', 10)
        self.tf_broadcaster = TransformBroadcaster(self)
        self.create_subscription(Twist, '/cmd_vel', self._cmd_vel_cb, 10)

        # ---- Etat de la commande (logique de cmd_to_serial_v2.py) ----
        self.current_v    = 0.0
        self.current_w    = 0.0
        self.target_v     = 0.0
        self.target_w     = 0.0
        self.accel_step   = 0.05    # m/s par 100ms (rampe acceleration)
        self.last_cmd_time = time.time()

        # Timer 100ms : envoi commande + rampe (comme cmd_to_serial_v2.py)
        self.create_timer(0.1, self._update_speed)

        # ---- Etat odometrique (logique de encoder_node.py) ----
        self.x          = 0.0
        self.y          = 0.0
        self.theta      = 0.0
        self.prev_left  = 0
        self.prev_right = 0
        self.enc_initialized = False

        # ---- Thread de lecture des encodeurs ----
        self._running = True
        self._reader  = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

        self.get_logger().info('SerialBridge demarre. En attente de donnees encodeurs L:XX R:XX ...')

    # ----------------------------------------------------------
    #  EMISSION : /cmd_vel → Arduino
    #  (logique identique a cmd_to_serial_v2.py)
    # ----------------------------------------------------------
    def _cmd_vel_cb(self, msg: Twist):
        self.last_cmd_time = time.time()
        self.target_v = msg.linear.x
        self.target_w = msg.angular.z

    def _update_speed(self):
        # Auto-stop si pas de commande depuis 0.3s
        if time.time() - self.last_cmd_time > 0.3:
            self.target_v = 0.0
            self.target_w = 0.0

        # Rampe lineaire
        if abs(self.target_v - self.current_v) <= self.accel_step:
            self.current_v = self.target_v
        elif self.target_v > self.current_v:
            self.current_v += self.accel_step
        else:
            self.current_v -= self.accel_step

        if abs(self.target_w - self.current_w) <= self.accel_step:
            self.current_w = self.target_w
        elif self.target_w > self.current_w:
            self.current_w += self.accel_step
        else:
            self.current_w -= self.accel_step

        # Envoyer a l'Arduino (format v:lin,w:ang)
        cmd = f'v:{self.current_v:.3f},w:{self.current_w:.3f}\n'
        try:
            self.ser.write(cmd.encode('utf-8'))
        except serial.SerialException as e:
            self.get_logger().error(f'Erreur ecriture serie: {e}')

    # ----------------------------------------------------------
    #  RECEPTION : Arduino → encodeurs "L:XXX R:XXX"
    #  (logique identique a encoder_node.py)
    # ----------------------------------------------------------
    def _read_loop(self):
        while self._running:
            try:
                raw  = self.ser.readline()
                if not raw:
                    continue
                line = raw.decode(errors='ignore').strip()

                if 'L:' in line and 'R:' in line:
                    self._process_encoder_line(line)

            except serial.SerialException as e:
                self.get_logger().error(f'Erreur lecture serie: {e}')
                break

    def _process_encoder_line(self, line: str):
        """Parse 'L:1234 R:5678' et publie /odom + TF."""
        try:
            parts = line.split()
            left  = int(parts[0].split(':')[1])
            right = int(parts[1].split(':')[1])
        except (IndexError, ValueError):
            self.get_logger().warn(f'Ligne encodeur mal formee: {line}')
            return

        if not self.enc_initialized:
            self.prev_left  = left
            self.prev_right = right
            self.enc_initialized = True
            return

        # Deltas et distances (identique a encoder_node.py)
        d_left  = (left  - self.prev_left)  / TICKS_PER_REV * WHEEL_CIRC
        d_right = (right - self.prev_right) / TICKS_PER_REV * WHEEL_CIRC
        self.prev_left  = left
        self.prev_right = right

        dist   = (d_left + d_right) / 2.0
        dtheta = (d_right - d_left) / WHEEL_BASE

        self.theta += dtheta
        self.x     += dist * math.cos(self.theta)
        self.y     += dist * math.sin(self.theta)

        self._publish_odom()

    def _publish_odom(self):
        now = self.get_clock().now().to_msg()

        # nav_msgs/Odometry
        odom = Odometry()
        odom.header.stamp    = now
        odom.header.frame_id = self.odom_frame
        odom.child_frame_id  = self.base_frame
        odom.pose.pose.position.x = self.x
        odom.pose.pose.position.y = self.y
        odom.pose.pose.orientation.z = math.sin(self.theta / 2.0)
        odom.pose.pose.orientation.w = math.cos(self.theta / 2.0)
        odom.twist.twist.linear.x  = self.current_v
        odom.twist.twist.angular.z = self.current_w
        self.odom_pub.publish(odom)

        # TF odom → base_link
        t = TransformStamped()
        t.header.stamp    = now
        t.header.frame_id = self.odom_frame
        t.child_frame_id  = self.base_frame
        t.transform.translation.x = self.x
        t.transform.translation.y = self.y
        t.transform.rotation.z    = math.sin(self.theta / 2.0)
        t.transform.rotation.w    = math.cos(self.theta / 2.0)
        self.tf_broadcaster.sendTransform(t)

    def destroy_node(self):
        self._running = False
        if self.ser.is_open:
            self.ser.close()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = SerialBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
