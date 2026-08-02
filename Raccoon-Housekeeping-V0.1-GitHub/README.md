# Raccoon Housekeeping — V0.1 terrain

Application de préparation, distribution et suivi des chambres pour les équipes d’étages.

Cette V0.1 reprend le parcours validé pour l’Hôtel Les Chevaliers : tableau des 90 chambres, statuts groupés, équipe du jour, distribution pondérée, tâches annexes, alertes, feuilles individuelles, contrôles, incidents techniques et rapports PDF.

## Ce qui fonctionne dès l’installation

- sauvegarde automatique de chaque journée dans le navigateur ;
- reprise après fermeture ou coupure de connexion ;
- changement de date sans écraser les journées précédentes ;
- PDF de secours du tableau complet ;
- PDF individuels séparant nettement les chambres à blanc et les recouches ;
- installation sur téléphone, tablette ou ordinateur comme une application ;
- fonctionnement hors ligne après une première ouverture ;
- paramètres multi-hôtel : logos, chambres, typologies, temps, alertes, personnel et consignes.

Sans base Supabase configurée, l’application fonctionne en **mode local** : les données restent sur l’appareil utilisé. C’est pratique pour une démonstration, mais ce mode ne synchronise pas plusieurs appareils.

## Mise en ligne sur GitHub et Vercel

1. Créer un dépôt GitHub vide.
2. Déposer tous les fichiers de ce dossier à la racine du dépôt.
3. Dans Vercel, choisir **Add New → Project**, puis importer le dépôt.
4. Laisser Vercel détecter Next.js et lancer le déploiement.

Le fichier `vercel.json` utilise automatiquement la commande adaptée à Vercel.

## Activer les vrais comptes et la synchronisation

La version partagée utilise Supabase pour l’authentification et la base de données.

1. Créer un projet sur Supabase.
2. Ouvrir **SQL Editor**, copier tout le contenu de `supabase/schema.sql`, puis l’exécuter.
3. Dans les réglages API Supabase, relever :
   - l’URL du projet ;
   - la clé publique/publishable.
4. Dans **Vercel → Project Settings → Environment Variables**, ajouter :
   - `NEXT_PUBLIC_SUPABASE_URL` ;
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Redéployer le projet.
6. Sur l’écran de connexion, créer le premier compte. Sur une base vide, il devient automatiquement **Administrateur**.
7. Dans **Paramètres → Comptes utilisateurs**, autoriser les autres adresses e-mail et choisir leur fonction. Chaque personne pourra ensuite créer son propre mot de passe avec l’adresse autorisée.

Ne jamais placer une clé `service_role` dans GitHub, Vercel côté public ou une variable commençant par `NEXT_PUBLIC_`. Seule la clé publique/publishable est prévue ici.

## Icône et installation

Le logo raton laveur est utilisé pour :

- le favicon du navigateur ;
- l’icône de l’application installée ;
- l’écran de connexion ;
- une signature discrète dans le menu.

Sur tablette ou téléphone, ouvrir le menu du navigateur puis choisir **Ajouter à l’écran d’accueil** ou **Installer l’application**.

## Utilisation terrain conseillée

Pendant les premiers jours, garder la feuille habituelle en parallèle et générer régulièrement le **PDF de secours du tableau de bord**. Noter les anomalies et améliorations, puis les regrouper avant chaque mise à jour.

Version actuelle : **0.1.0**.

## Développement local

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run build:vercel
npm run dev
```

Copier `.env.example` vers `.env.local` uniquement si le mode Supabase doit être testé localement.

## Structure utile

- `app/` : interface et logique métier ;
- `public/` : logos, icônes PWA, manifeste et mode hors ligne ;
- `lib/cloud.ts` : connexion Supabase ;
- `supabase/schema.sql` : base, droits et fonctions d’administration ;
- `.env.example` : noms des variables à configurer ;
- `vercel.json` : déploiement Vercel.
