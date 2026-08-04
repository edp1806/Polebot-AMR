#!/usr/bin/env python3
"""
polebot_amr_real_rplidar.launch.py
===================================
Launch file pour le robot physique Polebot (3 roues omnidirectionnelles)
avec RPLidar A1, SANS odometrie encodeurs.

Stack lancee :
  1. RPLidar A1          → /scan
  2. static TF           → base_link → laser
  3. fake_odom_publisher → /odom + TF odom → base_link
  4. SLAM Toolbox        → /map + TF map → odom
  5. rosbridge WebSocket → port 9090
  6. pose_publisher      → /robot_pose

Prerequis :
  sudo apt install ros-humble-rplidar-ros
  sudo chmod a+rw /dev/ttyUSB0

Usage :
  ros2 launch polebot_amr_bringup polebot_amr_real_rplidar.launch.py
  ros2 launch polebot_amr_bringup polebot_amr_real_rplidar.launch.py lidar_port:=/dev/ttyUSB1
"""

import os
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory


def generate_launch_description():

    pkg_bringup = get_package_share_directory('polebot_amr_bringup')

    # -------------------------------------------------------
    # Launch arguments
    # -------------------------------------------------------
    lidar_port_arg = DeclareLaunchArgument(
        'lidar_port',
        default_value='/dev/ttyUSB0',
        description='Serial port for RPLidar A1 (usually /dev/ttyUSB0)'
    )

    use_rviz_arg = DeclareLaunchArgument(
        'use_rviz',
        default_value='false',
        description='Launch RViz for debug visualization'
    )

    lidar_port = LaunchConfiguration('lidar_port')

    # -------------------------------------------------------
    # 1. RPLidar A1 (Pilote officiel C++ — Recommande)
    # -------------------------------------------------------
    rplidar_node = Node(
        package='rplidar_ros',
        executable='rplidar_node',
        name='rplidar_node',
        output='screen',
        parameters=[{
            'serial_port': lidar_port,
            'serial_baudrate': 115200,
            'frame_id': 'laser',
            'inverted': False,
            'angle_compensate': True,
            'scan_mode': 'Sensitivity',
        }]
    )

    # -------------------------------------------------------
    # 2. Static TF : base_link → laser
    #    Ajuster x/y/z si le LiDAR n'est pas centre sur le robot
    # -------------------------------------------------------
    static_tf_base_laser = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='base_link_to_laser',
        # args: x y z yaw pitch roll parent child
        arguments=['0.0', '0.0', '0.1', '0', '0', '0', 'base_link', 'laser'],
        output='screen'
    )

    # -------------------------------------------------------
    # 3. Fake Odom Publisher
    #    Publie /odom + TF odom → base_link en integrant /cmd_vel
    #    (sera remplace par un vrai odom encodeurs quand disponible)
    # -------------------------------------------------------
    fake_odom_node = Node(
        package='polebot_amr_bringup',
        executable='fake_odom_publisher',
        name='fake_odom_publisher',
        output='screen',
        parameters=[{
            'use_sim_time': False,
            'publish_rate': 30.0,
        }]
    )

    # -------------------------------------------------------
    # 4. SLAM Toolbox (online async, sans odom)
    # -------------------------------------------------------
    slam_params_file = PathJoinSubstitution([
        pkg_bringup, 'config', 'polebot_amr_mapper_params.yaml'
    ])

    slam_toolbox_node = Node(
        package='slam_toolbox',
        executable='async_slam_toolbox_node',
        name='slam_toolbox',
        output='screen',
        parameters=[
            slam_params_file,
            {'use_sim_time': False}
        ]
    )

    # -------------------------------------------------------
    # 5. ROSBridge WebSocket (dashboard web)
    # -------------------------------------------------------
    rosbridge_node = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        output='screen',
        parameters=[{
            'port': 9090,
            'address': '',          # listen on all interfaces
            'retry_startup_delay': 5.0,
        }]
    )

    # -------------------------------------------------------
    # 6. Pose Publisher (pour le dashboard)
    # -------------------------------------------------------
    pose_publisher_node = Node(
        package='polebot_analytics',
        executable='pose_publisher',
        name='pose_publisher',
        output='screen',
    )

    return LaunchDescription([
        # Arguments
        lidar_port_arg,
        use_rviz_arg,

        # Nodes (ordre important : TF avant SLAM)
        static_tf_base_laser,
        fake_odom_node,
        rplidar_node,
        slam_toolbox_node,
        rosbridge_node,
        pose_publisher_node,
    ])
