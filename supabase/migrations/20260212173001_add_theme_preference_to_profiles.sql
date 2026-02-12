/*
  # Add theme preference to user profiles

  1. Changes
    - Add `theme_preference` column to `profiles` table
      - Values: 'light' or 'dark'
      - Default: 'light'
    - Add `ksef_sort_preference` column to store sorting preferences
  
  2. Security
    - Users can update their own theme preference
*/

-- Add theme preference column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'theme_preference'
  ) THEN
    ALTER TABLE profiles ADD COLUMN theme_preference text DEFAULT 'light' CHECK (theme_preference IN ('light', 'dark'));
  END IF;
END $$;

-- Add KSEF sort preference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'ksef_sort_preference'
  ) THEN
    ALTER TABLE profiles ADD COLUMN ksef_sort_preference jsonb DEFAULT '{"unassigned": "import_date", "assigned": "assignment_date"}'::jsonb;
  END IF;
END $$;