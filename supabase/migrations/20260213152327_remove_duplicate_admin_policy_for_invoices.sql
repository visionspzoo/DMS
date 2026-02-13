/*
  # Remove Duplicate Admin Policy for Invoices

  ## Problem
  - There are TWO SELECT policies for invoices:
    1. "Admins can view all invoices" - allows admins to see everything
    2. "Users can view invoices based on role and department" - already includes admin check
  - This duplication causes confusion and the first policy is redundant
  - Both policies are PERMISSIVE which means they work as OR
  
  ## Solution
  - Remove the old "Admins can view all invoices" policy
  - Keep only "Users can view invoices based on role and department" which already handles admins
*/

DROP POLICY IF EXISTS "Admins can view all invoices" ON invoices;
