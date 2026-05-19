<script setup>

import { useBattery } from '../composables/useBattery.js'
const { battery, dischargeRate, estimatedAutonomy, formattedUsageTime, updateBattery, resetBattery} = useBattery()

</script>

<template>
    <div style="padding: 20px">
        <h2>📊 Performance Indicators (KPI)</h2>
        <!-- Section BATTERY -->
        <h3>🔋 Battery Usage</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
      
            <!-- Carte 1 : Niveau actuel -->
            <div class="kpi-card">
                <div class="kpi-label">Current Level</div>
                <div class="kpi-value">{{ Math.round(battery) }}%</div>
            </div>
            <!-- Carte 2 : Taux de décharge -->
            <div class="kpi-card">
                <div class="kpi-label">Discharge Rate</div>
                <div class="kpi-value">{{ dischargeRate.toFixed(2) }} %/min</div>
            </div>
            <!-- Carte 3 : Autonomie estimée -->
            <div class="kpi-card">
                <div class="kpi-label">Estimated Autonomy</div>
                <div class="kpi-value">{{ estimatedAutonomy }}</div>
            </div>
            <!-- Carte 4 : Temps d'utilisation -->
            <div class="kpi-card">
                <div class="kpi-label">Usage Time</div>
                <div class="kpi-value">{{ formattedUsageTime }}</div>
            </div>
        </div>
        <!-- Section MOVEMENT EFFICIENCY (à faire plus tard) -->
        <!-- Section CYCLE TIME (à faire plus tard) -->
  </div>
</template>

<style scoped>
.kpi-card {
    background-color: #ffffff; /* Arrière-plan blanc */
    border: 1px solid #e2e8f0;   /* Bordure gris clair */
    border-radius: 8px;          /* Coins arrondis */
    padding: 20px 25px;          /* Espacement intérieur */
    display: flex;               /* Activer Flexbox */
    flex-direction: column;      /* Empiler les éléments verticalement */
    justify-content: center;     /* Centrer verticalement */
    align-items: center;         /* Centrer horizontalement */
    transition: transform 0.2s, box-shadow 0.2s; /* Effet de survol doux */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); /* Ombre légère */
    cursor: pointer;
}

/* Effet de survol (hover) */
.kpi-card:hover {
    transform: translateY(-4px); /* Remonte légèrement */
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); /* Ombre plus prononcée */
}

/* Style pour le libellé (Current Level, etc.) */
.kpi-label {
    font-size: 0.85rem;          /* Taille de police légèrement plus petite */
    font-weight: 600;            /* Police en gras */
    color: #64748b;              /* Couleur gris foncé */
    margin-bottom: 8px;          /* Marge en dessous */
    text-transform: uppercase;   /* Texte en majuscules */
    letter-spacing: 0.5px;       /* Espacement des lettres */
}

/* Style pour la valeur (100%, 50%, etc.) */
.kpi-value {
    font-size: 2.25rem;          /* Grande taille de police */
    font-weight: 700;            /* Police en gras */
    color: #1e293b;              /* Couleur noir/gris très foncé */
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* Police moderne */
}

/* Marge entre les cartes (sur les côtés seulement, pour que ça reste aligné) */
.kpi-card:not(:last-child) {
    margin-right: 15px;
}

h2 {
    color: #1e293b;
    font-size: 1.5rem;
}
h3 {
    color: #334155;
    font-size: 1.1rem;
    margin-top: 20px;
    margin-bottom: 10px;
}
</style>
