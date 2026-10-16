# Application Android de DataHouse

Application Capacitor qui ouvre le site DataHouse en plein écran (`server.url`), avec le partage et
l'enregistrement de fichiers natifs (rapports PDF, exports CSV). Toute mise à jour du site apparaît
donc aussitôt dans l'application, sans réinstallation.

- Compilation : flux GitHub Actions `apk.yml` (à chaque modification de `mobile/`, ou manuellement).
- Téléchargement : https://github.com/Themauritian1996/datahouse/releases/download/apk/DataHouse.apk
- Signature : `debug.keystore` (clé de débogage Android standard, mot de passe public `android`).
  Elle garde la même signature d'une version à l'autre pour permettre les mises à jour par-dessus.
  **Pour publier sur Google Play**, créer une vraie clé de signature et la garder secrète.
