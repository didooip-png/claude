<?php
// =====================================================================
//  CONFIGURATION — à remplir avec les informations de ton hébergeur
//  (espace client > Bases de données / phpMyAdmin)
// =====================================================================
defined('APP') || exit;

return [
    // Base de données MySQL / MariaDB
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'quiz_ses',
    'db_user' => 'utilisateur_mysql',
    'db_pass' => 'mot_de_passe_mysql',

    // Fuseau horaire utilisé pour les dates (exports CSV)
    'timezone' => 'Europe/Paris',

    // Passer à true uniquement pour déboguer (affiche le détail des erreurs)
    'debug' => false,
];
