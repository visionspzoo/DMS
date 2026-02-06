/*
  # Dodanie statusu "Oczekujące" (waiting)

  1. Zmiany
    - Dodanie nowego statusu 'waiting' do typu invoice_status
    - Status 'waiting' będzie domyślnym statusem dla nowych faktur
    - Status 'waiting' reprezentuje faktury oczekujące na weryfikację
  
  2. Opis statusów
    - waiting: Oczekujące - domyślny status dla nowych faktur
    - pending: W weryfikacji - faktura w trakcie sprawdzania
    - in_review: W weryfikacji - faktura jest przeglądana
    - approved: W weryfikacji - faktura zaakceptowana do dalszego procesu
    - accepted: Zaakceptowana - faktura ostatecznie zatwierdzona
    - rejected: Odrzucona - faktura odrzucona
*/

-- Dodaj nowy status 'waiting' do istniejącego typu enum
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'waiting';

-- Zmień domyślny status dla nowych faktur na 'waiting'
ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'waiting';

-- Aktualizuj istniejące faktury ze statusem 'pending' które nie mają przypisanego następnego kroku
-- (opcjonalne, możemy pozostawić istniejące dane bez zmian)
