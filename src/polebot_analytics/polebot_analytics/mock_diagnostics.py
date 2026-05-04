#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus

class MockDiagnosticsNode(Node):
    def __init__(self):
        super().__init__('mock_diagnostics')
        self.publisher_ = self.create_publisher(DiagnosticArray, '/diagnostics', 10)
        
        # Publie les diagnostics toutes les 2 secondes
        self.timer = self.create_timer(2.0, self.timer_callback)
        self.get_logger().info('Mock Diagnostics Node démarré ! Envoi de faux statuts...')

        # Compteur pour simuler des changements de statut
        self.counter = 0

    def timer_callback(self):
        msg = DiagnosticArray()
        msg.header.stamp = self.get_clock().now().to_msg()
        
        # Capteur 1: LiDAR
        lidar_status = DiagnosticStatus()
        lidar_status.name = 'lidar_sensor'
        lidar_status.level = DiagnosticStatus.OK # 0 = OK
        lidar_status.message = 'Lidar OK'

        # Capteur 2: Caméra
        camera_status = DiagnosticStatus()
        camera_status.name = 'depth_camera'
        # On simule un petit problème (WARN) toutes les 10 secondes (5 ticks)
        if self.counter % 5 == 0:
            camera_status.level = DiagnosticStatus.WARN # 1 = WARN
            camera_status.message = 'Camera Surchauffe (Simulation)'
        else:
            camera_status.level = DiagnosticStatus.OK
            camera_status.message = 'Camera OK'

        # Capteur 3: SLAM/MAP
        map_status = DiagnosticStatus()
        map_status.name = 'slam_map'
        map_status.level = DiagnosticStatus.OK
        map_status.message = 'Map OK'

        msg.status = [lidar_status, camera_status, map_status]
        self.publisher_.publish(msg)
        self.get_logger().info(f'Diagnostics publiés (Tick {self.counter}) - Caméra: {camera_status.level}')
        self.counter += 1

def main(args=None):
    rclpy.init(args=args)
    node = MockDiagnosticsNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
