# Mise à jour V0.2 — ordre à respecter

Cette version est préparée mais ne doit être appliquée qu’après validation de la maquette.

## En fin de journée

1. Générer le PDF de secours du tableau du jour.
2. Générer le rapport d’étage de la journée.
3. Vérifier que l’application indique « Synchronisé ».
4. Fermer l’application sur les autres appareils pendant la mise à jour.

## Mise à jour Supabase

1. Ouvrir Supabase puis **SQL Editor**.
2. Ouvrir le fichier `supabase/migration-v0.2.sql`.
3. Copier tout son contenu dans une nouvelle requête.
4. Cliquer sur **Run** et vérifier le message **Success**.

Ne pas relancer `supabase/schema.sql`. La migration V0.2 ajoute uniquement la table des réglages permanents et récupère les fiches de la journée la plus récente.

## Mise à jour GitHub et Vercel

1. Remplacer dans GitHub les fichiers de la V0.1 par ceux du dossier V0.2.
2. Ne pas modifier les deux variables Supabase déjà enregistrées dans Vercel.
3. Attendre le redéploiement automatique de Vercel.
4. Ouvrir l’application et vérifier le personnel, les chambres HS et la journée en cours.

## Contrôles rapides après mise à jour

- changer de date puis revenir : le personnel reste présent dans le référentiel ;
- ajouter une tâche annexe puis ouvrir Personnel : elle n’y apparaît pas ;
- mettre une chambre HS puis changer de date : elle reste HS ;
- passer un problème technique à Réparé : la coche disparaît mais l’événement reste dans Rapports ;
- sélectionner PDF puis cliquer sur Publier : les feuilles PDF sont générées automatiquement.
- ouvrir Tableau des communs puis une zone : les trois actions sont disponibles ;
- vérifier qu’une demande de ménage exige commentaire, attribution et durée ;
- vérifier qu’un problème technique dans un commun accepte une photo.
