# Debugowanie OCR - Instrukcje krok po kroku

## Problem: OCR nie wypełnia danych faktury

### Krok 1: Sprawdź czy klucz Mistral API jest skonfigurowany

1. Otwórz Supabase Dashboard: https://supabase.com/dashboard
2. Wybierz swój projekt
3. W menu po lewej wybierz **"Project Settings"** (ikona koła zębatego)
4. Przejdź do zakładki **"Edge Functions"**
5. Znajdź sekcję **"Secrets"** lub **"Environment variables"**
6. Sprawdź czy istnieje sekret o nazwie: `MISTRAL_API_KEY`

**Jeśli NIE ma tego sekretu:**
- Kliknij "Add secret" lub "New secret"
- Nazwa: `MISTRAL_API_KEY`
- Wartość: `AF44X4mbWkyt1FrGzVn0ueyqCA2SZQEK`
- Kliknij "Save" lub "Create"
- **Odczekaj 1-2 minuty**, aby funkcje Edge pobrały nową konfigurację

### Krok 2: Prześlij fakturę i sprawdź logi w przeglądarce

1. Otwórz aplikację w przeglądarce
2. Naciśnij **F12** (lub Ctrl+Shift+I / Cmd+Option+I na Mac)
3. Przejdź do zakładki **"Console"**
4. Kliknij przycisk "Dodaj fakturę" w aplikacji
5. Wybierz plik PDF
6. Prześlij fakturę

**Obserwuj konsol ę - szukaj:**
```
=== STARTING OCR PROCESS ===
Invoice ID: [uuid]
File URL: [url]
OCR Endpoint: [url]
OCR Response Status: [number]
```

### Krok 3: Sprawdź status odpowiedzi OCR

**Jeśli widzisz status 401:**
- Klucz API nie jest skonfigurowany lub jest nieprawidłowy
- Wróć do Kroku 1 i upewnij się, że klucz jest dodany
- Sprawdź czy nazwa sekretu to dokładnie `MISTRAL_API_KEY` (bez spacji)

**Jeśli widzisz status 500:**
- Przejdź do Kroku 4, aby sprawdzić logi Edge Function

**Jeśli widzisz status 200:**
- OCR zadziałał! Sprawdź:
  - Czy w konsoli widzisz: `OCR SUCCESS! Response: {...}`
  - Czy w konsoli widzisz wyparsowane dane: `Extracted data: {...}`
  - Otwórz fakturę z listy i sprawdź czy pola są wypełnione

**Jeśli widzisz błąd CORS:**
- Funkcja Edge może nie być poprawnie wdrożona
- Przejdź do Kroku 5

### Krok 4: Sprawdź logi Edge Function w Supabase

1. Otwórz Supabase Dashboard
2. W menu po lewej wybierz **"Edge Functions"**
3. Znajdź funkcję **"process-invoice-ocr"**
4. Kliknij na nią
5. Przejdź do zakładki **"Logs"** lub **"Invocations"**
6. Sprawdź ostatnie wywołania

**Szukaj:**
- Błędów autoryzacji API (Mistral/OpenAI)
- Błędów parsowania JSON
- Błędów pobierania pliku z URL
- Błędów aktualizacji bazy danych

### Krok 5: Ponownie wdróż funkcję OCR (jeśli potrzebne)

Jeśli po dodaniu klucza API nadal nie działa:

1. W terminalu (na serwerze/lokalnie gdzie masz projekt):
```bash
# Opcja 1: Użyj Supabase CLI
supabase functions deploy process-invoice-ocr

# Opcja 2: Jeśli nie masz CLI, w Supabase Dashboard:
# - Idź do Edge Functions
# - Znajdź process-invoice-ocr
# - Kliknij "Redeploy" lub usuń i wdróż ponownie
```

2. Poczekaj 1-2 minuty na propagację zmian

### Krok 6: Test ręczny funkcji OCR

Możesz przetestować funkcję bezpośrednio przez API:

```bash
curl -X POST \
  'https://[TWOJ-PROJEKT].supabase.co/functions/v1/process-invoice-ocr' \
  -H 'Authorization: Bearer [TWOJ-ANON-KEY]' \
  -H 'Content-Type: application/json' \
  -d '{
    "fileUrl": "https://[URL-DO-PLIKU-PDF]",
    "invoiceId": "[UUID-FAKTURY]"
  }'
```

### Krok 7: Problem z wyświetlaniem PDF

**Jeśli PDF się nie wyświetla w podglądzie:**

1. Kliknij "Otwórz w nowej karcie" - jeśli tam się wyświetla, to problem z iframe
2. Sprawdź konsolę (F12) czy są błędy związane z CORS lub CSP
3. Sprawdź czy URL pliku działa - skopiuj URL i wklej w nowej karcie

**Możliwe rozwiązania:**
- Niektóre przeglądarki blokują iframe z zewnętrznymi PDF
- Chrome/Edge/Firefox powinny działać poprawnie
- Safari może mieć problemy - użyj "Otwórz w nowej karcie"

### Najczęstsze problemy i rozwiązania

| Problem | Rozwiązanie |
|---------|------------|
| Status 401 w OCR | Dodaj klucz `MISTRAL_API_KEY` w Supabase Secrets |
| Status 500 w OCR | Sprawdź logi Edge Function w Supabase |
| Brak logów w konsoli | Upewnij się że masz najnowszą wersję kodu |
| PDF się nie wyświetla | Kliknij "Otwórz w nowej karcie" |
| OCR się nie uruchamia | Sprawdź czy funkcja jest wdrożona w Supabase |
| Dane nie są zapisywane | Sprawdź logi Edge Function - może być problem z bazą |

### Kontakt z supportem

Jeśli żaden z powyższych kroków nie pomógł, zbierz:
1. Screenshot konsoli przeglądarki (F12 → Console)
2. Screenshot logów Edge Function z Supabase
3. URL pliku PDF, który próbujesz przesłać
4. Pełny tekst błędu

---

## Szybki checklist ✓

- [ ] Klucz `MISTRAL_API_KEY` jest dodany w Supabase Secrets
- [ ] Odczekano 1-2 minuty po dodaniu klucza
- [ ] Konsola (F12) pokazuje logi OCR
- [ ] Status odpowiedzi OCR to 200
- [ ] Funkcja `process-invoice-ocr` jest wdrożona w Supabase
- [ ] Bucket `documents` jest publiczny
- [ ] Pliki są widoczne w Supabase Storage
