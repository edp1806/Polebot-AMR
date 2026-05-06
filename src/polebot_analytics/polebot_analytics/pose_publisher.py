#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import PoseStamped
from tf2_ros import TransformException
from tf2_ros.buffer import Buffer
from tf2_ros.transform_listener import TransformListener

class PosePublisherNode(Node):
    def __init__(self):
        super().__init__('pose_publisher')
        self.publisher_ = self.create_publisher(PoseStamped, '/robot_pose', 10)
        self.laser_pub_ = self.create_publisher(PoseStamped, '/laser_pose', 10)
        
        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)

        # On interroge la TF 10 fois par seconde (10Hz)
        self.timer = self.create_timer(0.1, self.timer_callback)
        self.get_logger().info('Pose Publisher Node démarré ! Écoute de map -> base_footprint...')

    def timer_callback(self):
        # On va tester deux repères courants pour le robot
        frames_to_try = ['base_footprint', 'base_link']
        
        # 1. Publier la position du centre du robot (base_link)
        robot_found = False
        for frame in frames_to_try:
            try:
                t = self.tf_buffer.lookup_transform(
                    'map',
                    frame,
                    rclpy.time.Time())
                
                # Création du message de position
                msg = PoseStamped()
                msg.header.stamp = self.get_clock().now().to_msg()
                msg.header.frame_id = 'map'
                
                msg.pose.position.x = t.transform.translation.x
                msg.pose.position.y = t.transform.translation.y
                msg.pose.position.z = t.transform.translation.z
                
                msg.pose.orientation = t.transform.rotation
                
                self.publisher_.publish(msg)
                robot_found = True
                break

            except TransformException as ex:
                pass
                
        # Si on arrive ici, c'est qu'aucun repère n'a fonctionné
        if not robot_found:
            self.get_logger().warning('En attente de la TF entre map et base_footprint/base_link...', throttle_duration_sec=5.0)

        # 2. Publier la position exacte du LiDAR (laser_link)
        laser_frames = ['laser_link', 'laser', 'scan', 'base_scan', 'lidar_link']
        for frame in laser_frames:
            try:
                t_laser = self.tf_buffer.lookup_transform(
                    'map',
                    frame,
                    rclpy.time.Time())
                
                msg_laser = PoseStamped()
                msg_laser.header.stamp = self.get_clock().now().to_msg()
                msg_laser.header.frame_id = 'map'
                
                msg_laser.pose.position.x = t_laser.transform.translation.x
                msg_laser.pose.position.y = t_laser.transform.translation.y
                msg_laser.pose.position.z = t_laser.transform.translation.z
                msg_laser.pose.orientation = t_laser.transform.rotation
                
                self.laser_pub_.publish(msg_laser)
                break
            except TransformException as ex:
                pass

def main(args=None):
    rclpy.init(args=args)
    node = PosePublisherNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
