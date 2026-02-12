/*
  # Add filter preferences to profiles

  1. Changes
    - Add `filter_preferences` column to profiles table
      - Type: JSONB
      - Stores user's saved filter settings for the invoice list page
      - Includes: selectedYear, selectedMonth, selectedStatuses, selectedDepartments, searchQuery

  2. Notes
    - Column is nullable and defaults to NULL
    - Users can save their preferred filter settings which persist across sessions
    - RLS policies automatically apply to this column through existing profile policies
*/

-- Add filter_preferences column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS filter_preferences JSONB DEFAULT NULL;

-- Create index for faster JSONB queries (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_profiles_filter_preferences
ON profiles USING gin(filter_preferences);