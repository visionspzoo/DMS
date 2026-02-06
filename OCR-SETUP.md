# Konfiguracja OCR dla Faktur

## Szybki Start

System OCR wymaga skonfigurowania klucza API dla jednego z dwóch serwisów AI:

1. **Mistral AI** (zalecane) - najlepsze dla PDF i obrazów
2. **OpenAI** (alternatywa) - dobre dla obrazów

## Mistral AI (Zalecane)

### Dlaczego Mistral?
- Natywna obsługa plików PDF
- Obsługuje obrazy (JPG, PNG)
- Dobra jakość wyników dla dokumentów
- Model: pixtral-12b-2409

### Jak skonfigurować:

1. Utwórz konto na https://console.mistral.ai/
2. Przejdź do sekcji "API Keys"
3. Kliknij "Create new key"
4. Skopiuj klucz API

5. W Supabase Dashboard:
   - Otwórz swój projekt
   - Przejdź do "Edge Functions" w menu
   - Kliknij "Manage secrets"
   - Dodaj nowy sekret:
     - Nazwa: `MISTRAL_API_KEY`
     - Wartość: [Twój klucz Mistral]

## OpenAI (Alternatywa)

### Jak skonfigurować:

1. Utwórz konto na https://platform.openai.com/
2. Przejdź do https://platform.openai.com/api-keys
3. Kliknij "Create new secret key"
4. Skopiuj klucz (zaczyna się od `sk-`)

5. W Supabase Dashboard:
   - Otwórz swój projekt
   - Przejdź do "Edge Functions" w menu
   - Kliknij "Manage secrets"
   - Dodaj nowy sekret:
     - Nazwa: `OPENAI_API_KEY`
     - Wartość: [Twój klucz OpenAI]

## Jak to działa?

Po skonfigurowaniu klucza API:

1. Użytkownik przesyła fakturę (PDF lub obraz)
2. Plik jest zapisywany w Supabase Storage
3. System automatycznie wywołuje funkcję OCR
4. AI analizuje dokument i wyciąga dane:
   - Numer faktury
   - Nazwa dostawcy
   - NIP dostawcy
   - Data wystawienia
   - Termin płatności
   - Kwota netto
   - Kwota VAT
   - Kwota brutto
   - Waluta
5. Dane są automatycznie zapisywane w bazie
6. Status faktury zmienia się na "W weryfikacji"
7. Użytkownik może je przejrzeć i zaakceptować/odrzucić

## Co jeśli nie skonfiguruję OCR?

Aplikacja będzie działać, ale:
- Dane faktur NIE będą automatycznie wypełniane
- Użytkownicy będą musieli ręcznie edytować każdą fakturę
- Pliki nadal będą przesyłane i przechowywane

## Testowanie

Po skonfigurowaniu klucza:

1. Otwórz aplikację
2. Prześlij fakturę testową (PDF lub obraz)
3. Otwórz konsolę przeglądarki (F12)
4. Szukaj komunikatów:
   - ✅ "OCR processing successful" - działa!
   - ❌ "OCR: [błąd]" - sprawdź klucz API

5. Otwórz fakturę - dane powinny być wypełnione

## Rozwiązywanie problemów

### "Neither MISTRAL_API_KEY nor OPENAI_API_KEY configured"
- Nie skonfigurowałeś żadnego klucza API
- Dodaj jeden z kluczy w Supabase Dashboard

### "Mistral API error: 401"
- Nieprawidłowy klucz Mistral
- Sprawdź czy skopiowałeś cały klucz
- Upewnij się, że klucz jest aktywny

### "OpenAI API error: 401"
- Nieprawidłowy klucz OpenAI
- Sprawdź czy klucz zaczyna się od `sk-`
- Upewnij się, że masz środki na koncie OpenAI

### OCR zwraca puste dane
- Plik może być zbyt niewyraźny
- Spróbuj użyć lepszej jakości skanu
- Sprawdź czy faktura zawiera wszystkie wymagane informacje

### "Failed to parse AI response"
- Problem z formatowaniem odpowiedzi AI
- Zazwyczaj rozwiązuje się sam przy kolejnej próbie
- Sprawdź logi w Supabase Dashboard

## Koszty

### Mistral AI
- Model: pixtral-12b-2409
- Cena: ~$0.25 za 1M tokenów input
- Typowa faktura: ~1000-2000 tokenów
- Koszt za fakturę: ~$0.0005 (mniej niż 1 grosz)

### OpenAI
- Model: gpt-4o
- Cena: ~$5 za 1M tokenów input (obrazy)
- Typowa faktura: ~500-1000 tokenów
- Koszt za fakturę: ~$0.0025-0.005 (1-2 grosze)

## Priorytet użycia

Jeśli skonfigurujesz oba klucze:
1. PDF → Mistral AI (priorytet)
2. Obrazy → Mistral AI (jeśli dostępny) lub OpenAI
3. Jeśli Mistral nie odpowiada → fallback na OpenAI (dla obrazów)

## Bezpieczeństwo

- Klucze API są przechowywane bezpiecznie w Supabase
- NIE są widoczne w kodzie aplikacji
- NIE są wysyłane do przeglądarki
- Tylko Edge Functions mają do nich dostęp

## Google Drive (Opcjonalnie)

To jest osobna funkcja. OCR działa niezależnie od Google Drive.
Zobacz osobną dokumentację dla konfiguracji Google Drive.
