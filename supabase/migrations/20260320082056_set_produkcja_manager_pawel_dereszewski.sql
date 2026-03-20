/*
  # Set Produkcja department manager to Paweł Dereszewski

  ## Summary
  The "Produkcja" department currently has no manager_id set, causing purchase requests
  from that department to go directly to the director (Natalia Michalak).
  
  Per business requirement, purchase requests from Produkcja should first go to
  Paweł Dereszewski (manager of "Technologia Produkcji") who also oversees Produkcja.

  ## Changes
  - Sets manager_id of "Produkcja" department to Paweł Dereszewski's profile ID

  ## Notes
  - Paweł Dereszewski: id = 45c35694-a198-4057-b1f7-1865519e98bf, role = Kierownik
  - Produkcja department: id = 90a29ba5-cfab-44cb-9d32-e0e804aacad0
*/

UPDATE departments
SET manager_id = '45c35694-a198-4057-b1f7-1865519e98bf'
WHERE id = '90a29ba5-cfab-44cb-9d32-e0e804aacad0';
