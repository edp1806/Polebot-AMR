# 🚀 Plan d'Extensions de Stage & Fonctionnalités Bonus - Polebot AMR

Ce document détaille les fonctionnalités "Bonus" à forte valeur ajoutée développées en complément du plan de stage initial pour le projet **"Development of a Web-Based ROS Interface, Data Historian, and Analytical Platform for the Polebot Autonomous Mobile Robot"** (sous la direction de M. **Wahyu Adhie CANDRA**).

Ces extensions transforment l'interface en une plateforme de supervision industrielle moderne, robuste et interactive, prête pour des tests en conditions réelles.

---

## 🌟 Synthèse des Fonctionnalités Bonus

Pour aller au-delà des objectifs de base du stage (visualisation simple et stockage InfluxDB à 1 Hz), nous avons conçu et implémenté quatre extensions majeures :

### 1. 📍 Bonus 1 : Navigation Interactive par Clic (Click-to-Navigate)
*   **Objectif** : Permettre à l'utilisateur de commander le robot de manière intuitive directement depuis la carte SLAM 2D.
*   **Implémentation** :
    *   Capture des coordonnées en pixels du clic sur le `<canvas>` de la carte dans `LiveControl.vue`.
    *   Transformation mathématique 2D via une fonction de conversion pixel-vers-monde (`canvasToWorld`) dans `useMap.js` (en tenant compte du zoom et de la résolution de la carte ROS).
    *   Publication du but de navigation sur le topic ROS 2 `/goal_pose` via `useRos.js` sous forme de message `geometry_msgs/PoseStamped`.
    *   **Bouton d'annulation ("Cancel Goal")** intégré élégamment pour annuler la mission en cours.

### 2. 🚨 Bonus 2 : Système d'Alarmes de Sécurité (Audio Synth & HUD Visuel)
*   **Objectif** : Alerter l'opérateur immédiatement en cas de danger, même s'il ne regarde pas l'écran.
*   **Implémentation** :
    *   **Synthétiseur Audio Web (Web Audio API)** dans `useAudio.js` pour générer des signaux sonores de sécurité dynamiques en temps réel (sans dépendance à des fichiers audio externes).
    *   Génération d'un son oscillant dissonant de type industriel pour l'**Arrêt d'Urgence (E-STOP)** et d'un signal à impulsions rapides pour le **danger de collision (Proximité Lidar)**.
    *   **HUD Visuel de Sécurité** : Une bannière d'alarme animée et prioritaire s'affichant en haut de l'interface en cas de déclenchement, avec bouton de coupure du son ("Mute/Unmute").

### 3. 📊 Bonus 3 : Panneau de Métriques Dynamiques (Navigation Metrics)
*   **Objectif** : Fournir une visibilité en temps réel sur la progression de la navigation autonome.
*   **Implémentation** :
    *   **Calcul de la Distance au But** : Calcul géométrique de la distance euclidienne restante entre la position odométrique actuelle $(X, Y)$ et le point de destination actif.
    *   **Jauges de Vitesse Dynamiques** : Affichage en pourcentage de la vitesse linéaire et angulaire actuelle par rapport aux limites maximales du robot.
    *   **Rendu Premium** : Cartes semi-transparentes (glassmorphism) positionnées stratégiquement dans la colonne de gauche sous les données de position pour une lisibilité parfaite.

### 4. 📈 Bonus 4 : Outils d'Analytique Avancée & Reporting Pro (KPIs & Sessions)
*   **Objectif** : Exploiter les données de l'historien pour fournir des analyses de performance approfondies et des rapports professionnels exportables.
*   **Implémentation** :
    *   **KPIs Industriels Complexes** :
        *   **Movement Efficiency (%)** : Pourcentage de temps durant lequel le robot a été réellement actif par rapport à sa période de connexion (vitesse > 0.02 m/s).
        *   **Stability Index (Indice de Stabilité)** : Algorithme mesurant la fluidité du déplacement du robot en pénalisant les accélérations brusques et les à-coups (Jerk).
    *   **InfluxDB Session Historian** : Pipeline enregistrant chaque session de fonctionnement du robot (heure de démarrage, heure d'arrêt, durée totale) dans la table `robot_session` d'InfluxDB.
    *   **Exportateurs PDF & CSV de Haute Qualité** :
        *   Génération de fichiers CSV détaillés de la télémétrie filtrée par période.
        *   Rapports PDF professionnels générés avec `jsPDF` incluant les statistiques clés (durées, moyennes, efficacités) et des captures blanches propres des graphiques (via un plugin forçant le fond blanc pour le rendu à l'export).

### 5. 📶 Bonus 5 : Moniteur de Latence & Mode Faible Bande Passante (Low Bandwidth Mode)
*   **Objectif** : Assurer la réactivité de l'IHM et la sécurité des commandes en environnement industriel à couverture Wi-Fi instable.
*   **Implémentation** :
    *   **Mesure de Ping en Temps Réel** : Calcul toutes les 3 secondes du temps d'aller-retour (RTT en ms) des requêtes WebSocket (via un appel ultra-rapide à `ros.getNodes()` natif de `roslibjs`).
    *   **Indicateur Réseau Code-Couleur** : Affichage d'un badge 📶 dynamique et élégant dans la barre supérieure, passant au Vert (Excellent, <30ms), Orange (Avertissement, <100ms) ou Rouge (Critique, >=100ms).
    *   **Mode Faible Bande Passante Automatique** : Si le ping dépasse 150 ms, l'IHM active automatiquement le mode `Low Bandwidth` qui **divise par 5 la fréquence de rendu de la carte SLAM 2D** (le composant le plus lourd). Cela libère instantanément du CPU et de la bande passante réseau, garantissant que les messages de commande `/cmd_vel` et l'arrêt d'urgence restent prioritaires et réactifs sans aucune latence.

### 6. ⬛ Bonus 6 (Bonus B) : Boîte Noire des Incidents (Incident Black Box & Persistance)
*   **Objectif** : Enregistrer de manière résiliente et persistante tous les événements critiques et incidents du robot (comme les déclenchements d'arrêt d'urgence, pertes de connexion, détections d'obstacles proches, ou batteries critiques) pour faciliter le diagnostic et la maintenance post-incident.
*   **Implémentation** :
    *   **Architecture Dédiée (`useBlackBox.js`)** : Création d'un composable spécifique avec persistance dans le stockage local du navigateur (`localStorage`) pour survivre aux rafraîchissements de page et aux redémarrages.
    *   **Déclenchement Automatique par Écouteurs (Watchers)** :
        *   **Arrêt d'Urgence (E-STOP)** : Journalisation immédiate avec sévérité `Critical` lors de l'activation/désactivation de l'arrêt d'urgence.
        *   **Perte de Connexion** : Journalisation avec sévérité `Critical` en cas de déconnexion du pont WebSocket ROS2.
        *   **Risque de Collision (Lidar)** : Journalisation avec sévérité `Warning` si la distance de l'obstacle le plus proche mesurée par le Lidar descend sous la limite sécuritaire.
        *   **Batterie Faible** : Journalisation avec sévérité `Warning` dès que la batterie descend sous la barre des 20%.
        *   **Navigation Active** : Enregistrement avec sévérité `Info` à chaque envoi de but autonome ou annulation manuelle par l'opérateur.
    *   **Double Onglet Interactif dans l'IHM** : Intégration dans le panneau latéral droit d'un sélecteur d'onglets ergonomique permettant de basculer instantanément entre les *Logs Système* temporaires et la *Boîte Noire des Incidents*.
    *   **Outils d'Export et de Nettoyage** : Boutons intégrés pour exporter instantanément les logs au format JSON (`📥 Export`) pour analyse par les équipes de maintenance et pour réinitialiser le journal de bord (`🗑️ Clear`).

