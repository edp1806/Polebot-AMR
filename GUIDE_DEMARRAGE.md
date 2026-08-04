# 🤖 Guide de Démarrage — Polebot AMR
**Projet** : Development of a Web-Based ROS Interface, Data Historian & Analytical Platform  
**Superviseur** : M. Wahyu Adhie CANDRA  
**Dernière mise à jour** : Juin 2026

> ⚠️ **Ce guide est destiné aux opérateurs et techniciens autorisés uniquement.**  
> Ne jamais allumer le robot en présence de personnes dans la zone de déplacement.

---

## 📑 Table des Matières

1. [Vérifications Avant Allumage](#1-vérifications-avant-allumage)
2. [Configuration Réseau](#2-configuration-réseau)
3. [Démarrage en Mode SIMULATION (Gazebo)](#3-démarrage-en-mode-simulation-gazebo)
4. [Démarrage sur le ROBOT PHYSIQUE](#4-démarrage-sur-le-robot-physique)
5. [Lancement du Dashboard Web](#5-lancement-du-dashboard-web)
6. [Connexion & Utilisation du Dashboard](#6-connexion--utilisation-du-dashboard)
7. [Téléopération Mobile (Téléphone)](#7-téléopération-mobile-téléphone)
8. [Procédure d'Arrêt Propre](#8-procédure-darrêt-propre)
9. [Résolution de Problèmes](#9-résolution-de-problèmes)

---

## 1. Vérifications Avant Allumage

Avant d'allumer quoi que ce soit, vérifiez les points suivants :

- [ ] La **batterie du robot** est chargée (indicator LED vert sur le châssis)
- [ ] Aucun **obstacle** n'est présent dans la zone de déplacement prévue (rayon minimum 1 m)
- [ ] Le câble **Ethernet LiDAR** est bien branché (LiDAR Autonics LSC → switch réseau)
- [ ] La caméra **Orbbec Astra** est branchée en USB sur le PC embarqué du robot
- [ ] Le PC de supervision (votre ordinateur) est **connecté au même réseau Wi-Fi** que le robot

---

## 2. Configuration Réseau

### Adresses IP du système

| Équipement | Adresse IP | Port |
|---|---|---|
| LiDAR Autonics LSC | `192.168.0.1` | `8000` |
| PC embarqué du robot | `192.168.0.X` *(à confirmer)* | — |
| ROSBridge WebSocket | `<IP_du_PC>` | `9090` |
| Dashboard Web (Vite) | `<IP_du_PC>` | `5173` |
| InfluxDB | `<IP_du_PC>` | `8086` |

### Vérifier la connexion réseau avec le LiDAR

Depuis un terminal sur le PC du robot :
```bash
ping 192.168.0.1
```
Si pas de réponse → vérifier les câbles et la configuration de l'interface réseau.

---

## 3. Démarrage en Mode SIMULATION (Gazebo)

> Utilisez ce mode pour tester le dashboard **sans le robot physique**.

### Étape 1 — Préparer l'environnement ROS 2

Ouvrez un terminal dans le dossier workspace :
```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr
source /opt/ros/jazzy/setup.bash
colcon build
source install/setup.bash
```

### Étape 2 — Lancer la simulation complète

Cette commande démarre tout en une seule fois : Gazebo, SLAM, Nav2, RViz et le pont WebSocket.
```bash
ros2 launch polebot_amr_bringup polebot_amr_sim_nav_webgui.launch.py
```

**Ce qui se lance automatiquement :**
- 🌍 **Gazebo** — Simulateur physique (monde `depot.sdf`)
- 🗺️ **SLAM Toolbox** — Cartographie en temps réel
- 🧭 **Nav2** — Stack de navigation autonome
- 🖥️ **RViz** — Visualisation 3D ROS
- 🌐 **ROSBridge WebSocket** — Pont de communication sur le port `9090`
- 📍 **pose_publisher** — Node ROS qui publie la position du robot sur `/robot_pose`

Attendez que la console affiche :
```
[rosbridge_websocket] Rosbridge WebSocket server started on port 9090
```
→ Le système est prêt.

---

## 4. Démarrage sur le ROBOT PHYSIQUE

> Utilisez ce mode pour les tests et opérations réelles en atelier.

### Étape 1 — Préparer l'environnement ROS 2

```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr
source /opt/ros/jazzy/setup.bash
source install/setup.bash
```

### Étape 2 — Lancer les capteurs et la navigation

```bash
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py
```

**Ce qui se lance automatiquement :**
- 📡 **LiDAR Autonics LSC** — Driver `lsc_ros2_driver`, IP `192.168.0.1`, port `8000`
- 📷 **Caméra Orbbec Astra** — Résolution 640×480, 30 FPS
- 🗺️ **SLAM Toolbox** — Mode synchrone (`sync_slam_toolbox_node`)
- 🧭 **Nav2** — Stack de navigation complète
- 🖥️ **RViz** — Visualisation 3D (optionnel, `use_rviz:=false` pour désactiver)

### Étape 3 — Lancer le pont WebSocket (terminal séparé)

```bash
source /opt/ros/jazzy/setup.bash && source install/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

### Étape 4 — Lancer le node de position (terminal séparé)

```bash
ros2 run polebot_analytics pose_publisher
```

### Options avancées

```bash
# Lancer sans RViz (pour économiser les ressources)
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py use_rviz:=false

# Lancer avec une carte existante (mode localisation uniquement, sans SLAM)
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py slam:=False map:=/chemin/vers/carte.yaml

# Lancer le joystick physique (manette)
ros2 launch polebot_amr_bringup polebot_amr_real_joy.launch.py
```

---

## 5. Lancement du Dashboard Web

> Le dashboard doit être lancé sur le **PC de supervision** (votre ordinateur).

### Étape 1 — Démarrer le serveur Vite

```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr/src/polebot_analytics/dashboard
npm run dev
```

La console affiche quelque chose comme :
```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://10.172.105.220:5173/
```

> ⚠️ **Important** : Pour que le téléphone puisse accéder au dashboard, utilisez **toujours** l'URL **Network** (avec votre IP réelle), et non `localhost`.

### Étape 2 — Démarrer InfluxDB (si pas automatique)

```bash
influxd
```
Vérifier l'accès sur : `http://localhost:8086`

---

## 6. Connexion & Utilisation du Dashboard

### Accéder au dashboard

Ouvrez votre navigateur et allez sur :
```
http://<VOTRE_IP>:5173
```
*(Exemple : `http://10.172.105.220:5173`)*

### Se connecter

| Rôle | Identifiant | Mot de passe | Droits |
|---|---|---|---|
| **Administrateur** | `polebot01` | `polebot@amr01` | Contrôle total du robot + analytics |
| **Opérateur 1** | `polebot02` | `polebot@amr02` | Lecture seule (pas de commande) |
| **Opérateur 2** | `polebot03` | `polebot@amr03` | Lecture seule (pas de commande) |

> 🔐 La session est valide jusqu'à la fermeture de l'onglet du navigateur.

### Connecter le dashboard au robot

1. Dans la barre supérieure, vérifiez que l'URL WebSocket est correcte :
   ```
   ws://<IP_DU_ROBOT_OU_PC>:9090
   ```
2. Cliquez sur le bouton bleu **▶ Connect**.
3. Le badge doit passer au vert : `● ROS2 Connected`.
4. La carte SLAM commence à apparaître sur l'onglet **Live Control**.

### Navigation par clic sur la carte

1. Assurez-vous que le robot est connecté et que SLAM est actif.
2. Dans l'onglet **Live Control**, cliquez sur un point de la carte 2D.
3. Un objectif de navigation `goal_pose` est envoyé automatiquement.
4. Cliquez sur **❌ Cancel Goal** pour annuler la mission en cours.

---

## 7. Téléopération Mobile (Téléphone)

> Réservée au rôle **Administrateur** uniquement.

### Première connexion

1. Sur le dashboard (ordinateur), cliquez sur **📱 Pair Mobile Device** dans la barre supérieure.
2. Un QR Code s'affiche avec l'URL de la page de téléopération.
3. Scannez le QR Code avec votre téléphone.
4. La page `/teleop` s'ouvre sur votre téléphone.
5. Connectez-vous avec vos identifiants admin.
6. Entrez l'URL WebSocket et appuyez sur **▶ Connect**.

### Si le QR Code ne fonctionne pas

Votre IP Wi-Fi a peut-être changé. Dans le champ IP du modal de pairing, corrigez l'adresse.
Pour trouver votre IP actuelle :
```bash
hostname -I
```

Ou entrez directement dans le navigateur du téléphone :
```
http://<IP_AFFICHÉE_PAR_VITE>:5173/teleop
```

### Contrôles sur mobile

| Contrôle | Action |
|---|---|
| **▲ Bouton Haut** | Avancer |
| **▼ Bouton Bas** | Reculer |
| **◀ Bouton Gauche** | Tourner à gauche |
| **▶ Bouton Droite** | Tourner à droite |
| **⏹ Bouton Central** | Stop immédiat |
| **HOLD 1s E-Stop** | Arrêt d'urgence logiciel |

---

## 8. Procédure d'Arrêt Propre

Respectez toujours cet ordre pour éviter la perte de données.

### Sur le dashboard Web

1. Cliquez sur **⏹ Disconnect** pour fermer la connexion WebSocket proprement.  
   *(Cela enregistre automatiquement la durée de la session dans InfluxDB)*
2. Fermez l'onglet du navigateur.

### Dans les terminaux ROS 2

Arrêtez les processus dans l'ordre inverse du lancement :

```bash
# 1. Stopper le ROSBridge (Ctrl+C dans le terminal concerné)
# 2. Stopper le pose_publisher (Ctrl+C)
# 3. Stopper le launch principal (Ctrl+C dans le terminal du launch)
```

Attendez que tous les processus soient terminés avant d'éteindre le robot.

### Arrêt physique du robot

1. Vérifier que le robot est immobile (vitesses = 0).
2. Éteindre l'interrupteur principal du châssis.
3. Débrancher les câbles USB et Ethernet si stockage prolongé.

---

## 9. Résolution de Problèmes

### ❌ "ROS2 Offline" — Le dashboard ne se connecte pas

| Cause possible | Vérification | Solution |
|---|---|---|
| ROSBridge non lancé | `ros2 node list` → pas de `/rosbridge_websocket` | Lancer le bridge (voir étape 3 section 4) |
| Mauvaise IP WebSocket | L'IP dans le champ ne correspond pas au PC du robot | Corriger avec `hostname -I` |
| Pare-feu bloqué | `sudo ufw status` | `sudo ufw allow 9090` |
| Mauvais réseau | PC et robot sur deux réseaux différents | Connecter au même Wi-Fi |

### ❌ La carte SLAM n'apparaît pas

- Vérifier que le topic `/map` est publié : `ros2 topic hz /map`
- Si 0 Hz → SLAM non lancé ou LiDAR non connecté
- Vérifier la connexion LiDAR : `ping 192.168.0.1`

### ❌ Le LiDAR ne publie pas

```bash
# Vérifier que le driver tourne
ros2 node list | grep lidar

# Vérifier les données brutes
ros2 topic echo /scan --once
```

### ❌ InfluxDB — Pas de données dans les graphiques

```bash
# Vérifier qu'InfluxDB tourne
curl http://localhost:8086/ping

# Redémarrer si nécessaire
influxd
```

### ❌ Le téléphone ne peut pas accéder au dashboard

1. Vérifier que téléphone et ordinateur sont sur le **même Wi-Fi**.
2. Récupérer la bonne IP : `hostname -I` dans un terminal.
3. Entrer `http://<IP>:5173` manuellement dans le navigateur du téléphone.
4. Vérifier que le pare-feu autorise le port 5173 : `sudo ufw allow 5173`

### ❌ Arrêt d'urgence bloqué (E-Stop locked)

Sur le dashboard : Cliquez sur le bouton **🔧 Resolve E-Stop** dans la bannière rouge.  
Sur la page mobile : Appuyez sur **🔧 Unlock** sous le bouton E-Stop.

---

*Guide rédigé dans le cadre du stage de fin d'études — Polman Bandung, 2026.*  
*Pour toute question : contacter M. Wahyu Adhie CANDRA.*
