import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Upload,
  CheckCircle,
  XCircle,
  CreditCard,
  ArrowRight,
  Download,
  Zap,
  HardDrive,
  Mail,
  FileText,
  Clock,
  AlertTriangle,
  RefreshCw,
  Send,
  Eye,
  Edit2,
  Trash2,
  Filter,
  Search,
  Building2,
  User,
  Shield,
  Info,
  ChevronUp,
  Tag,
  Bell,
  GitBranch,
  Settings,
} from 'lucide-react';

interface Section {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
}

const sections: Section[] = [
  {
    id: 'workflow',
    title: 'Obieg faktur',
    icon: GitBranch,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
  {
    id: 'ksef',
    title: 'Faktury KSEF',
    icon: Download,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    id: 'automation',
    title: 'Automatyzacje',
    icon: Zap,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
  },
  {
    id: 'integrations',
    title: 'Google Drive i Email',
    icon: HardDrive,
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50 dark:bg-rose-900/20',
    borderColor: 'border-rose-200 dark:border-rose-800',
  },
];

interface StepProps {
  number: number;
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}

function Step({ number, title, description, icon: Icon, color = 'bg-brand-primary' }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full ${color} text-white flex items-center justify-center text-sm font-bold`}>
          {Icon ? <Icon className="w-4 h-4" /> : number}
        </div>
        <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-2 min-h-4" />
      </div>
      <div className="pb-6">
        <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm">{title}</p>
        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

interface ButtonDocProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  color: string;
  roles?: string[];
}

function ButtonDoc({ icon: Icon, label, description, color, roles }: ButtonDocProps) {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
      <div className={`flex-shrink-0 w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm">{label}</p>
          {roles && roles.map(r => (
            <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-text-secondary-light dark:text-text-secondary-dark border border-slate-200 dark:border-slate-700">
              {r}
            </span>
          ))}
        </div>
        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: string;
  label: string;
  description: string;
  color: string;
}

function StatusBadge({ status, label, description, color }: StatusBadgeProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700/50">
      <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-full font-medium border ${color}`}>{label}</span>
      <div>
        <p className="font-medium text-text-primary-light dark:text-text-primary-dark text-sm">{status}</p>
        <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm mt-0.5">{description}</p>
      </div>
    </div>
  );
}

interface InfoBoxProps {
  type: 'info' | 'warning' | 'tip';
  children: React.ReactNode;
}

function InfoBox({ type, children }: InfoBoxProps) {
  const styles = {
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
    warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
    tip: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300',
  };
  const icons = {
    info: Info,
    warning: AlertTriangle,
    tip: CheckCircle,
  };
  const Icon = icons[type];
  return (
    <div className={`flex gap-2.5 p-3 rounded-lg border text-sm ${styles[type]}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

function WorkflowSection() {
  return (
    <div className="space-y-5 pt-3">
      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Statusy faktur</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Każda faktura przechodzi przez kolejne etapy — poniżej wyjaśnienie co oznacza każdy status.
        </p>
        <div className="space-y-2">
          <StatusBadge
            status="Robocze"
            label="Robocze"
            description="Faktura została przesłana ale jeszcze nie skierowana do obiegu. Tylko przesyłający ją widzi. Można ją edytować i usunąć."
            color="bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400"
          />
          <StatusBadge
            status="Oczekujące"
            label="Oczekujące"
            description="Faktura trafiła do osoby zatwierdzającej i czeka na jej decyzję. Przesyłający nie może jej już edytować."
            color="bg-yellow-500/10 text-yellow-700 border-yellow-500/30 dark:text-yellow-400"
          />
          <StatusBadge
            status="W weryfikacji"
            label="W weryfikacji"
            description="Faktura jest w trakcie weryfikacji przez przełożonego lub Dyrektora. Czeka na akceptację na wyższym szczeblu."
            color="bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400"
          />
          <StatusBadge
            status="Zaakceptowana"
            label="Zaakceptowana"
            description="Faktura została zatwierdzona. Oczekuje teraz na oznaczenie jako opłacona przez uprawnioną osobę."
            color="bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400"
          />
          <StatusBadge
            status="Odrzucona"
            label="Odrzucona"
            description="Faktura została odrzucona. Przesyłający widzi powód odrzucenia i może poprawić fakturę lub przesłać ponownie."
            color="bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400"
          />
          <StatusBadge
            status="Opłacona"
            label="Opłacona"
            description="Faktura została opłacona. Status końcowy — faktura jest archiwizowana."
            color="bg-emerald-700/10 text-emerald-800 border-emerald-700/30 dark:text-emerald-400"
          />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Jak przebiega obieg faktury</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Standardowy przepływ faktury w systemie — od przesłania do opłacenia.
        </p>
        <div>
          <Step number={1} title="Przesłanie faktury (Specjalista)" description='Użytkownik wchodzi w "Moje Faktury" → "Prześlij fakturę". Wgrywa plik PDF lub JPG. System automatycznie odczytuje dane (OCR) — numer, dostawcę, kwotę, daty. Użytkownik weryfikuje dane i wybiera dział oraz centrum kosztów.' />
          <Step number={2} title='Przekazanie do obiegu (przycisk "Wyślij do obiegu")' description="Faktura zmienia status na Oczekujące i trafia do Kierownika działu jako osoba zatwierdzająca. Kierownik otrzymuje powiadomienie." />
          <Step number={3} title="Decyzja Kierownika" description="Kierownik widzi fakturę w swoim dashboardzie. Może ją zaakceptować (jeśli kwota mieści się w jego limicie), odrzucić z komentarzem lub przekazać wyżej do Dyrektora gdy kwota przekracza jego limit zatwierdzania." />
          <Step number={4} title="Decyzja Dyrektora (jeśli wymagana)" description="Gdy Kierownik przekaże fakturę wyżej lub gdy kwota przekracza limit Kierownika, Dyrektor zatwierdza lub odrzuca fakturę. Status zmienia się na Zaakceptowana." />
          <Step number={5} title='Oznaczenie jako opłaconej (przycisk "Oznacz jako opłaconą")' description="Po akceptacji faktura czeka na opłacenie. Admin, Dyrektor lub uprawniony użytkownik oznacza fakturę jako opłaconą. Plik automatycznie przenoszony jest do folderu Opłacone na Google Drive." color="bg-emerald-600" />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-4">Przyciski i ich funkcje</h3>
        <div className="space-y-2">
          <ButtonDoc
            icon={Upload}
            label="Prześlij fakturę"
            description='Otwiera formularz wgrywania faktury. Dostępny w "Moje Faktury" u góry strony.'
            color="bg-brand-primary"
            roles={['Wszyscy']}
          />
          <ButtonDoc
            icon={Send}
            label="Wyślij do obiegu"
            description="Przekazuje fakturę ze statusu Robocze do kolejki zatwierdzania. Faktura trafia do wybranego zatwierdzającego. Akcja nieodwracalna — po wysłaniu nie można edytować faktury."
            color="bg-blue-600"
            roles={['Specjalista']}
          />
          <ButtonDoc
            icon={CheckCircle}
            label="Zatwierdź"
            description="Akceptuje fakturę. Jeśli Kierownik zatwierdza w ramach swojego limitu — faktura trafia do statusu Zaakceptowana. Jeśli limit jest przekroczony — automatycznie przekazywana jest dalej do Dyrektora."
            color="bg-green-600"
            roles={['Kierownik', 'Dyrektor', 'Admin']}
          />
          <ButtonDoc
            icon={XCircle}
            label="Odrzuć"
            description="Odrzuca fakturę z możliwością wpisania powodu. Faktura wraca do przesyłającego ze statusem Odrzucona i komentarzem. Przesyłający może poprawić i wysłać ponownie."
            color="bg-red-600"
            roles={['Kierownik', 'Dyrektor', 'Admin']}
          />
          <ButtonDoc
            icon={ArrowRight}
            label="Przekaż wyżej"
            description="Kierownik może ręcznie przekazać fakturę do Dyrektora gdy kwota przekracza jego kompetencje lub gdy chce uzyskać dodatkowe zatwierdzenie."
            color="bg-amber-600"
            roles={['Kierownik']}
          />
          <ButtonDoc
            icon={CreditCard}
            label="Oznacz jako opłaconą"
            description="Kończy obieg faktury — ustawia status Opłacona z datą i osobą która oznaczyła. Plik przenoszony jest automatycznie na Google Drive do folderu Opłacone (jeśli skonfigurowano)."
            color="bg-emerald-700"
            roles={['Admin', 'Dyrektor', 'Kierownik', 'Specjalista']}
          />
          <ButtonDoc
            icon={Edit2}
            label="Edytuj"
            description="Edytuje dane faktury (numer, kwoty, daty, dostawcę, centrum kosztów). Dostępna gdy faktura jest w statusie Robocze lub Odrzucona. Admini mogą edytować dowolną fakturę."
            color="bg-slate-600"
            roles={['Przesyłający', 'Admin']}
          />
          <ButtonDoc
            icon={Trash2}
            label="Usuń"
            description="Trwale usuwa fakturę i jej plik. Dostępne tylko dla faktury w statusie Robocze lub Odrzucona. Operacja nieodwracalna."
            color="bg-red-700"
            roles={['Przesyłający', 'Admin']}
          />
          <ButtonDoc
            icon={Eye}
            label="Podgląd PDF"
            description="Otwiera plik faktury w podglądzie wbudowanym bezpośrednio w systemie. Nie wymaga pobierania pliku."
            color="bg-slate-500"
            roles={['Wszyscy uprawnieni']}
          />
          <ButtonDoc
            icon={RefreshCw}
            label="Przetwórz OCR ponownie"
            description="Ponownie uruchamia automatyczne odczytywanie danych z pliku PDF. Przydatne gdy pierwsze odczytanie było niepoprawne lub plik był złej jakości. Dostępne dla wszystkich użytkowników na fakturach w statusie Robocze lub Odrzucona."
            color="bg-blue-500"
            roles={['Wszyscy']}
          />
          <ButtonDoc
            icon={ArrowRight}
            label="Prześlij (Transfer)"
            description="Przenosi fakturę do innego działu lub osoby zatwierdzającej. Kierownik i Dyrektor mogą transferować faktury w swoim dziale. Admin może transferować każdą fakturę."
            color="bg-blue-700"
            roles={['Kierownik', 'Dyrektor', 'Admin']}
          />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Filtry i wyszukiwanie</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Na liście faktur dostępne są narzędzia do szybkiego znajdowania dokumentów.
        </p>
        <div className="space-y-2">
          <ButtonDoc
            icon={Search}
            label="Wyszukiwanie"
            description="Wyszukuje po numerze faktury, nazwie dostawcy lub kwocie. Wyszukiwanie działa na bieżąco podczas pisania."
            color="bg-slate-500"
          />
          <ButtonDoc
            icon={Filter}
            label="Filtry"
            description="Filtruje faktury według statusu, działu, daty wystawienia lub przedziału kwotowego. Można łączyć wiele filtrów jednocześnie. Ustawienia filtrów są zapamiętywane między sesjami."
            color="bg-slate-600"
          />
          <ButtonDoc
            icon={Tag}
            label="Tagi"
            description="Każda faktura może mieć przypisane kolorowe tagi ułatwiające kategoryzację. Tagi są widoczne na liście i można po nich filtrować."
            color="bg-blue-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Powiadomienia</h3>
        <div className="space-y-2">
          <ButtonDoc
            icon={Bell}
            label="Dzwonek powiadomień"
            description="Ikona dzwonka w górnym pasku pokazuje nowe zdarzenia: faktury czekające na zatwierdzenie, odrzucone faktury, przekazane faktury oraz zduplikowane faktury. Kliknięcie powiadomienia przenosi bezpośrednio do faktury."
            color="bg-amber-500"
          />
        </div>
      </div>

      <InfoBox type="tip">
        <strong>Wskazówka:</strong> Jeśli faktura jest odrzucona — nie musisz jej usuwać i przesyłać od nowa. Możesz ją edytować (poprawić dane) i ponownie wysłać do obiegu klikając "Wyślij do obiegu".
      </InfoBox>
    </div>
  );
}

function KSEFSection() {
  return (
    <div className="space-y-5 pt-3">
      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Czym są faktury KSEF?</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
          KSEF (Krajowy System e-Faktur) to rządowy system elektronicznych faktur. Faktury wystawione przez kontrahentów trafiają do KSEF i są automatycznie synchronizowane z systemem. Nie trzeba ich ręcznie wgrywać — system pobiera je samoczynnie.
        </p>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Jak działa synchronizacja</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Faktury KSEF są pobierane automatycznie co godzinę lub można uruchomić synchronizację ręcznie.
        </p>
        <div>
          <Step number={1} title="Automatyczne pobieranie" description="Co godzinę system łączy się z KSEF i pobiera nowe faktury. Faktury trafiają do zakładki Faktury KSEF jako nowe wpisy ze statusem Nowa." />
          <Step number={2} title="Przypisanie do działu" description="System automatycznie sprawdza NIP wystawcy faktury w regułach NIP-Dział. Jeśli reguła istnieje — faktura jest automatycznie przypisana do właściwego działu. Jeśli nie — trafia jako nieprzypisana i czeka na ręczne przypisanie." />
          <Step number={3} title="Podgląd i weryfikacja" description="W zakładce Faktury KSEF można podejrzeć pełne dane XML faktury, pobrać PDF oraz sprawdzić szczegóły transakcji. Faktury mają pełne dane dostawcy, kupującego, pozycji i kwot." />
          <Step number={4} title='Przeniesienie do obiegu (przycisk "Prześlij")' description='Gdy faktura KSEF jest gotowa do obiegu, kliknięcie "Prześlij" tworzy fakturę w systemie obiegu i uruchamia standardowy proces zatwierdzania. Dane są automatycznie skopiowane z KSEF.' color="bg-emerald-600" />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-4">Przyciski na liście KSEF</h3>
        <div className="space-y-2">
          <ButtonDoc
            icon={RefreshCw}
            label="Synchronizuj teraz"
            description="Ręcznie uruchamia pobieranie nowych faktur z KSEF. Normalnie synchronizacja odbywa się automatycznie co godzinę, ale można wywołać ją w każdej chwili."
            color="bg-emerald-600"
            roles={['Admin', 'Uprawnieni użytkownicy']}
          />
          <ButtonDoc
            icon={ArrowRight}
            label="Prześlij do obiegu"
            description="Konwertuje fakturę KSEF na fakturę w standardowym obiegu. Dane (numer, kwoty, daty, dostawca) są automatycznie przeniesione. Faktura pojawia się w Moich Fakturach ze statusem Robocze."
            color="bg-blue-600"
          />
          <ButtonDoc
            icon={Eye}
            label="Szczegóły / Podgląd XML"
            description="Otwiera szczegółowy widok faktury z danymi z KSEF — pełny XML, pozycje faktury, dane wystawcy i odbiorcy, numery referencyjne."
            color="bg-slate-500"
          />
          <ButtonDoc
            icon={Download}
            label="Pobierz PDF"
            description="Pobiera wizualizację faktury KSEF jako plik PDF. PDF jest generowany automatycznie na podstawie danych XML."
            color="bg-slate-600"
          />
          <ButtonDoc
            icon={XCircle}
            label="Ignoruj"
            description="Oznacza fakturę KSEF jako ignorowaną — nie pojawi się w listach do przetworzenia. Przydatne dla faktur które nie wymagają obiegu (np. duplikaty, błędne wpisy)."
            color="bg-red-500"
          />
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Statusy faktur KSEF</h3>
        <div className="space-y-2">
          <StatusBadge
            status="Nowa"
            label="Nowa"
            description="Faktura właśnie pobrana z KSEF, jeszcze nieprzypisana do działu ani nieprzetworzona."
            color="bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400"
          />
          <StatusBadge
            status="Przypisana"
            label="Przypisana"
            description="Faktura automatycznie przypisana do działu na podstawie reguły NIP. Gotowa do przesłania do obiegu."
            color="bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400"
          />
          <StatusBadge
            status="Przekazana"
            label="Przekazana"
            description="Faktura została przeniesiona do standardowego obiegu. Dalej widoczna w KSEF ale przetwarzana już w Moich Fakturach."
            color="bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400"
          />
          <StatusBadge
            status="Ignorowana"
            label="Ignorowana"
            description="Faktura oznaczona do pominięcia. Nie pojawia się w kolejce do przetworzenia."
            color="bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400"
          />
        </div>
      </div>

      <InfoBox type="info">
        <strong>Ważne:</strong> Faktury KSEF są tylko do odczytu — nie można edytować ich danych bezpośrednio w zakładce KSEF. Edycja jest możliwa dopiero po przesłaniu faktury do standardowego obiegu.
      </InfoBox>

      <InfoBox type="warning">
        <strong>Uwaga:</strong> Synchronizacja KSEF wymaga aktywnego połączenia z KSeF API oraz ważnych poświadczeń konfigurowanych przez Administratora systemu.
      </InfoBox>
    </div>
  );
}

function AutomationSection() {
  return (
    <div className="space-y-5 pt-3">
      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Czym są automatyzacje?</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
          Automatyzacje to reguły które system wykonuje samoczynnie — bez ingerencji użytkownika. Pomagają zaoszczędzić czas przy powtarzalnych czynnościach, takich jak przypisywanie faktur od tego samego dostawcy do właściwego działu.
        </p>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Reguły NIP — automatyczne przypisywanie</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Najważniejszy typ automatyzacji. Pozwala powiązać NIP dostawcy z konkretnym działem i centrum kosztów.
        </p>
        <div>
          <Step number={1} title="Tworzenie reguły" description='W zakładce "Konfiguracja" → "Automatyzacje NIP" kliknij "Dodaj regułę". Wpisz NIP dostawcy (możesz użyć podpowiedzi z istniejących faktur), wybierz dział i centrum kosztów.' />
          <Step number={2} title="Automatyczne działanie" description="Gdy nowa faktura (ręcznie przesłana lub z KSEF) zawiera NIP zgodny z regułą — system automatycznie przypisuje ją do właściwego działu i centrum kosztów. Użytkownik nie musi tego robić ręcznie." />
          <Step number={3} title="Aktualizacja reguły" description="Każda reguła może być edytowana i usuwana. Zmiana reguły nie wpływa retroaktywnie na faktury już przypisane — dotyczy tylko nowych faktur." color="bg-amber-600" />
        </div>

        <InfoBox type="tip">
          <strong>Tip:</strong> Reguły NIP są współdzielone między użytkownikami działu. Jeśli Kierownik stworzy regułę — działa ona dla wszystkich faktur KSEF trafiających do systemu.
        </InfoBox>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Automatyczne tagi ML</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          System uczy się na podstawie historycznych decyzji użytkowników i automatycznie sugeruje tagi dla nowych faktur.
        </p>
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
            <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm mb-1">Jak to działa?</p>
            <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark space-y-1">
              <p>Gdy ręcznie dodajesz tag do faktury — system zapamiętuje powiązanie: dostawca → tag.</p>
              <p>Następna faktura od tego samego dostawcy otrzyma automatyczną propozycję tagu.</p>
              <p>Można zaakceptować lub odrzucić propozycję — każda decyzja ulepsza model.</p>
              <p>Model jest indywidualny dla każdego użytkownika.</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Automatyczne wykrywanie duplikatów</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          System automatycznie sprawdza czy wgrywana faktura nie jest duplikatem już istniejącej.
        </p>
        <div className="p-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50 space-y-2">
          <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm">Sprawdzane kryteria:</p>
          <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark space-y-1">
            <p>Ten sam numer faktury od tego samego dostawcy (NIP).</p>
            <p>Identyczny plik (hash pliku) — nawet przy różnej nazwie.</p>
          </div>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-2">
            W przypadku wykrycia duplikatu — użytkownik i Admin otrzymują powiadomienie z linkiem do obu faktur. Decyzja o usunięciu należy do użytkownika.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Limity zatwierdzeń</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          System automatycznie weryfikuje uprawnienia przy zatwierdzaniu faktur w oparciu o limity kwotowe.
        </p>
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
            <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm mb-2">Hierarchia zatwierdzania:</p>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <User className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">Kierownik</p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Zatwierdza faktury do swojego indywidualnego limitu miesięcznego (ustawianego przez Dyrektora). Po przekroczeniu limitu — faktura automatycznie przekazywana jest do Dyrektora.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">Dyrektor</p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Zatwierdza faktury powyżej limitu Kierownika lub przekazane ręcznie. Posiada własny limit miesięczny — faktury powyżej wymagają zatwierdzenia Admina.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">Admin</p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak limitu — może zatwierdzić dowolną fakturę niezależnie od kwoty.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <InfoBox type="warning">
        <strong>Ważne:</strong> Limity działają na dwa sposoby: miesięczny (suma kwot netto zatwierdzonych faktur w danym miesiącu, resetuje się pierwszego dnia miesiąca) oraz na pojedynczą fakturę (faktura przekraczająca limit kwotowy wymaga zatwierdzenia przez wyższy szczebel niezależnie od sumy miesięcznej).
      </InfoBox>
    </div>
  );
}

function IntegrationsSection() {
  return (
    <div className="space-y-5 pt-3">
      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-4">Google Drive — synchronizacja plików</h3>

        <div>
          <Step number={1} title="Połączenie konta Google" description='W zakładce "Konfiguracja" → "Google Drive" kliknij "Połącz z Google Drive". Nastąpi przekierowanie do logowania Google. Po zalogowaniu wróć do systemu — połączenie jest aktywne.' />
          <Step number={2} title="Konfiguracja folderów" description="Admin konfiguruje foldery Google Drive dla każdego działu: folder roboczy (dla nowych faktur), folder dla zaakceptowanych i folder dla opłaconych. W Konfiguracji możesz też ustawić swój własny folder dla faktur z Twojego Drive." />
          <Step number={3} title="Automatyczne przenoszenie plików" description="Gdy faktura zmienia status — plik jest automatycznie przenoszony do odpowiedniego folderu. Przy zmianie na Zaakceptowana — trafia do folderu zaakceptowanych. Przy Opłacona — do folderu opłaconych." color="bg-emerald-600" />
        </div>

        <div className="space-y-2 mt-4">
          <ButtonDoc
            icon={HardDrive}
            label="Synchronizuj z Google Drive"
            description="Ręcznie pobiera faktury z wybranego folderu Google Drive. System skanuje folder, pobiera nowe pliki PDF i tworzy z nich faktury w systemie (z OCR). Przydatne gdy faktury są zapisywane ręcznie na Drive."
            color="bg-blue-600"
            roles={['Wszyscy z połączonym kontem Google']}
          />
          <ButtonDoc
            icon={HardDrive}
            label="Prześlij na Drive"
            description="Ręcznie wysyła plik faktury na Google Drive jeśli automatyczne przesłanie nie zadziałało. Dostępne w szczegółach faktury."
            color="bg-slate-600"
            roles={['Admin', 'Uprawnieni']}
          />
        </div>

        <InfoBox type="info">
          <strong>Jak to działa technicznie:</strong> Pliki są przechowywane na Twoim koncie Google Drive — system nie przechowuje plików własnych. Połączenie jest szyfrowane przez OAuth 2.0. Token odświeżany jest automatycznie.
        </InfoBox>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-4">Email — pobieranie faktur ze skrzynki</h3>

        <div>
          <Step number={1} title="Połączenie konta Gmail / Google Workspace" description='W "Konfiguracja" → "Poczta Gmail" kliknij "Połącz z Gmail". System uzyska uprawnienie do odczytu wiadomości e-mail. Wymagane konto Google Workspace lub Gmail.' />
          <Step number={2} title="Konfiguracja synchronizacji" description="Określ które wiadomości mają być przetwarzane — możesz ustawić filtr nadawcy, temat wiadomości lub etykietę Gmail. System będzie pobierał tylko e-maile spełniające kryteria." />
          <Step number={3} title="Automatyczne pobieranie załączników" description="System regularnie sprawdza skrzynkę i pobiera załączniki PDF ze spełniających kryteria e-maili. Każdy PDF jest automatycznie przetwarzany przez OCR i tworzona jest nowa faktura w systemie." color="bg-emerald-600" />
        </div>

        <div className="space-y-2 mt-4">
          <ButtonDoc
            icon={Mail}
            label="Synchronizuj e-maile"
            description="Ręcznie uruchamia pobieranie faktur z poczty e-mail. System skanuje skrzynkę zgodnie z skonfigurowanymi filtrami i importuje nowe faktury jako PDF."
            color="bg-red-500"
            roles={['Wszyscy z połączonym kontem Gmail']}
          />
        </div>

        <InfoBox type="tip">
          <strong>Tip:</strong> Połączenie e-mail działa najlepiej gdy wystawcy faktur przesyłają je bezpośrednio na Twój adres służbowy. Możesz też skonfigurować filter Gmail który automatycznie oznacza faktury etykietą — system pobierze tylko je.
        </InfoBox>

        <InfoBox type="warning">
          <strong>Prywatność:</strong> System ma dostęp tylko do odczytu poczty i tylko do załączników PDF. Nie czyta treści wiadomości. Połączenie można odwołać w dowolnym momencie w ustawieniach konta Google.
        </InfoBox>
      </div>

      <div>
        <h3 className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mb-1">Zarządzanie połączeniami</h3>
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
          Wszystkie połączenia zewnętrzne zarządzane są w sekcji Konfiguracja dostępnej w menu bocznym.
        </p>
        <div className="p-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50">
          <p className="font-semibold text-text-primary-light dark:text-text-primary-dark text-sm mb-2">W Konfiguracji znajdziesz:</p>
          <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark space-y-1">
            <p>Status połączenia z Google Drive (aktywne / wygasłe / brak).</p>
            <p>Status połączenia z Gmail.</p>
            <p>Mapowania folderów Drive do działów (admini).</p>
            <p>Preferencje synchronizacji e-mail.</p>
            <p>Przycisk rozłączenia konta Google.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InstructionsPage() {
  const [activeSection, setActiveSection] = useState<string>('workflow');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set(['workflow']));

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setActiveSection(id);
  };

  const renderContent = (id: string) => {
    switch (id) {
      case 'workflow': return <WorkflowSection />;
      case 'ksef': return <KSEFSection />;
      case 'automation': return <AutomationSection />;
      case 'integrations': return <IntegrationsSection />;
      default: return null;
    }
  };

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
            Instrukcje
          </h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
            Przewodnik użytkownika systemu Aura DMS
          </p>
        </div>

        {/* Quick Nav */}
        <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-4">
          {sections.map(section => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => {
                  setActiveSection(section.id);
                  if (!expandedCards.has(section.id)) {
                    setExpandedCards(prev => new Set([...prev, section.id]));
                  }
                  setTimeout(() => {
                    document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 50);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left ${
                  isActive
                    ? `${section.bgColor} ${section.borderColor}`
                    : 'bg-light-surface dark:bg-dark-surface border-slate-200 dark:border-slate-700/50 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? section.color : 'text-text-secondary-light dark:text-text-secondary-dark'}`} />
                <span className={`text-xs font-medium leading-tight ${isActive ? section.color : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
                  {section.title}
                </span>
              </button>
            );
          })}
        </div>

        {/* Accordion Sections */}
        <div className="space-y-2">
          {sections.map(section => {
            const Icon = section.icon;
            const isExpanded = expandedCards.has(section.id);
            return (
              <div
                key={section.id}
                id={`section-${section.id}`}
                className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden"
              >
                <button
                  onClick={() => toggleCard(section.id)}
                  className={`w-full flex items-center justify-between p-4 transition-colors hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${section.bgColor} ${section.borderColor} border`}>
                      <Icon className={`w-4 h-4 ${section.color}`} />
                    </div>
                    <div className="text-left">
                      <h2 className="text-sm font-bold text-text-primary-light dark:text-text-primary-dark">{section.title}</h2>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        {section.id === 'workflow' && 'Statusy, przyciski, przepływ faktur przez system'}
                        {section.id === 'ksef' && 'Pobieranie, synchronizacja i przekazywanie faktur KSEF'}
                        {section.id === 'automation' && 'Reguły NIP, limity, duplikaty, tagi ML'}
                        {section.id === 'integrations' && 'Połączenie z Google Drive i pobieranie faktur z e-maila'}
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                      : <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                    }
                  </div>
                </button>

                {isExpanded && (
                  <div className={`px-4 pb-4 pt-1 border-t ${section.borderColor}`}>
                    {renderContent(section.id)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 p-3 rounded-lg bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 text-center">
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Masz pytania lub problemy? Skontaktuj się z Administratorem systemu.
          </p>
        </div>
    </div>
  );
}
