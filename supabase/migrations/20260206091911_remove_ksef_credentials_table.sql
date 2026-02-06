/*
  # Remove KSEF Credentials Table

  1. Changes
    - Drop `ksef_credentials` table as it's no longer needed
    - KSEF integration now uses external Replit API connector
    - No user credentials are stored locally
  
  2. Notes
    - This is a safe operation as the table was only used for storing temporary KSEF tokens
    - The new integration model uses a centralized API with pre-configured credentials
*/

DROP TABLE IF EXISTS ksef_credentials CASCADE;
