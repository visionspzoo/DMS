import { jsPDF } from 'npm:jspdf@2.5.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface InvoicePdfData {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  saleDate: string;
  periodFrom: string;
  periodTo: string;
  invoiceType: string;
  seller: {
    prefixVat: string;
    nip: string;
    name: string;
    address1: string;
    address2: string;
    country: string;
  };
  buyer: {
    nip: string;
    name: string;
    address1: string;
    address2: string;
    country: string;
    corrAddress1?: string;
    corrAddress2?: string;
    corrCountry?: string;
    customerNumber?: string;
  };
  lineItems: Array<{
    lineNumber: string;
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    vatRate: string;
    netValue: number;
    grossValue: number;
  }>;
  additionalDescriptions: Array<{
    key: string;
    value: string;
  }>;
  bdo: string;
  systemInfo: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  currency: string;
  verificationUrl: string;
}

function parseInvoiceXml(xml: string, ksefNumber: string): InvoicePdfData {
  const getValue = (tagName: string): string => {
    const pattern = new RegExp(
      `<(?:[a-zA-Z0-9]+:)?${tagName}>([^<]+)</(?:[a-zA-Z0-9]+:)?${tagName}>`,
      's'
    );
    const match = xml.match(pattern);
    return match ? match[1].trim() : '';
  };

  const getValueFromBlock = (block: string, tagName: string): string => {
    const pattern = new RegExp(
      `<(?:[a-zA-Z0-9]+:)?${tagName}>([^<]+)</(?:[a-zA-Z0-9]+:)?${tagName}>`,
      's'
    );
    const match = block.match(pattern);
    return match ? match[1].trim() : '';
  };

  const podmiot1Match = xml.match(
    /<(?:[a-zA-Z0-9]+:)?Podmiot1>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Podmiot1>/
  );
  const podmiot1 = podmiot1Match ? podmiot1Match[1] : '';

  const podmiot2Match = xml.match(
    /<(?:[a-zA-Z0-9]+:)?Podmiot2>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Podmiot2>/
  );
  const podmiot2 = podmiot2Match ? podmiot2Match[1] : '';

  const adresKorespMatch = podmiot2.match(
    /<(?:[a-zA-Z0-9]+:)?AdresKoresp>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?AdresKoresp>/
  );
  const adresKoresp = adresKorespMatch ? adresKorespMatch[1] : '';

  const lineItems: any[] = [];
  const linePattern =
    /<(?:[a-zA-Z0-9]+:)?FaWiersz>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?FaWiersz>/g;
  let lineMatch;
  while ((lineMatch = linePattern.exec(xml)) !== null) {
    const line = lineMatch[1];
    lineItems.push({
      lineNumber: getValueFromBlock(line, 'NrWierszaFa') || String(lineItems.length + 1),
      name: getValueFromBlock(line, 'P_7'),
      unit: getValueFromBlock(line, 'P_8A') || 'SZT',
      quantity: parseFloat(getValueFromBlock(line, 'P_8B') || '1'),
      unitPrice: parseFloat(
        getValueFromBlock(line, 'P_9A') || getValueFromBlock(line, 'P_9B') || '0'
      ),
      vatRate: getValueFromBlock(line, 'P_12') || '23',
      netValue: parseFloat(getValueFromBlock(line, 'P_11') || '0'),
      grossValue: parseFloat(getValueFromBlock(line, 'P_11A') || '0'),
    });
  }

  lineItems.forEach((item) => {
    if (!item.netValue && item.unitPrice && item.quantity) {
      item.netValue = item.unitPrice * item.quantity;
    }
    if (!item.grossValue) {
      const vatMultiplier = parseFloat(item.vatRate) / 100;
      item.grossValue = item.netValue * (1 + vatMultiplier);
    }
  });

  const additionalDescriptions: any[] = [];
  const descPattern =
    /<(?:[a-zA-Z0-9]+:)?DodatkowyOpis>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?DodatkowyOpis>/g;
  let descMatch;
  while ((descMatch = descPattern.exec(xml)) !== null) {
    const desc = descMatch[1];
    additionalDescriptions.push({
      key: getValueFromBlock(desc, 'Klucz'),
      value: getValueFromBlock(desc, 'Wartosc'),
    });
  }

  const sellerNip = getValueFromBlock(podmiot1, 'NIP');
  const issueDate = getValue('P_1');
  const formattedDate = issueDate ? issueDate.split('-').reverse().join('-') : '';

  return {
    ksefNumber,
    invoiceNumber: getValue('P_2'),
    issueDate,
    saleDate: getValue('P_6'),
    periodFrom: getValue('P_6_Od'),
    periodTo: getValue('P_6_Do'),
    invoiceType: getValue('RodzajFaktury') || 'VAT',
    seller: {
      prefixVat: getValueFromBlock(podmiot1, 'PrefiksPodatnika') || 'PL',
      nip: sellerNip,
      name: getValueFromBlock(podmiot1, 'Nazwa'),
      address1: getValueFromBlock(podmiot1, 'AdresL1'),
      address2: getValueFromBlock(podmiot1, 'AdresL2'),
      country: getValueFromBlock(podmiot1, 'KodKraju') || 'PL',
    },
    buyer: {
      nip: getValueFromBlock(podmiot2, 'NIP'),
      name: getValueFromBlock(podmiot2, 'Nazwa'),
      address1: getValueFromBlock(podmiot2, 'AdresL1'),
      address2: getValueFromBlock(podmiot2, 'AdresL2'),
      country: getValueFromBlock(podmiot2, 'KodKraju') || 'PL',
      corrAddress1: getValueFromBlock(adresKoresp, 'AdresL1'),
      corrAddress2: getValueFromBlock(adresKoresp, 'AdresL2'),
      corrCountry: getValueFromBlock(adresKoresp, 'KodKraju'),
      customerNumber: getValueFromBlock(podmiot2, 'NrKlienta'),
    },
    lineItems,
    additionalDescriptions,
    bdo: getValue('BDO'),
    systemInfo: getValue('SystemInfo'),
    netAmount: parseFloat(getValue('P_13_1') || getValue('P_13_2') || '0'),
    vatAmount: parseFloat(getValue('P_14_1') || getValue('P_14_2') || '0'),
    grossAmount: parseFloat(getValue('P_15') || '0'),
    currency: getValue('KodWaluty') || 'PLN',
    verificationUrl: `https://qr.ksef.mf.gov.pl/invoice/${sellerNip}/${formattedDate}`,
  };
}

async function generateInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const robotoUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf';
  const robotoBoldUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf';

  try {
    const [normalFont, boldFont] = await Promise.all([
      fetch(robotoUrl).then(r => r.arrayBuffer()),
      fetch(robotoBoldUrl).then(r => r.arrayBuffer())
    ]);

    const normalBase64 = btoa(String.fromCharCode(...new Uint8Array(normalFont)));
    const boldBase64 = btoa(String.fromCharCode(...new Uint8Array(boldFont)));

    doc.addFileToVFS('Roboto-Regular.ttf', normalBase64);
    doc.addFileToVFS('Roboto-Bold.ttf', boldBase64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  } catch (e) {
    console.error('Failed to load fonts, using default', e);
  }

  const formatAmount = (amount: number | string) => {
    const num = parseFloat(String(amount || '0'));
    return num.toLocaleString('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
  };

  const countryName = (code: string) => (code === 'PL' ? 'Polska' : code);

  let y = 40;
  const leftMargin = 40;
  const rightCol = 310;
  const pageWidth = 515;

  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.text('Krajowy System e-Faktur', leftMargin, y);

  doc.setFontSize(9);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(102, 102, 102);
  doc.text('Numer Faktury:', rightCol, y, { align: 'right' });

  y += 15;
  doc.setFontSize(11);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(data.invoiceNumber || '-', 555, y, { align: 'right' });

  const invoiceTypeLabel =
    data.invoiceType === 'VAT' ? 'Faktura podstawowa' : `Faktura ${data.invoiceType}`;
  y += 15;
  doc.setFontSize(9);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(102, 102, 102);
  doc.text(invoiceTypeLabel, 555, y, { align: 'right' });

  y += 13;
  doc.setFontSize(8);
  doc.setTextColor(26, 86, 219);
  doc.text(`Numer KSEF: ${data.ksefNumber}`, 555, y, { align: 'right' });

  y += 30;
  doc.setFontSize(10);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Sprzedawca', leftMargin, y);
  doc.text('Nabywca', rightCol, y);
  y += 16;

  doc.setFontSize(9);
  doc.setFont('Roboto', 'normal');
  doc.text(`Prefiks VAT: ${data.seller?.prefixVat || 'PL'}`, leftMargin, y);
  doc.text(`NIP: ${data.buyer?.nip || '-'}`, rightCol, y);
  y += 12;

  doc.text(`NIP: ${data.seller?.nip || '-'}`, leftMargin, y);
  doc.text(`Nazwa: ${data.buyer?.name || '-'}`, rightCol, y);
  y += 12;

  const splitSellerName = doc.splitTextToSize(data.seller?.name || '-', 260);
  doc.text(`Nazwa: ${splitSellerName[0]}`, leftMargin, y);
  y += 16;

  doc.setFont('Roboto', 'bold');
  doc.text('Adres', leftMargin, y);
  doc.text('Adres', rightCol, y);
  doc.setFont('Roboto', 'normal');
  y += 12;

  if (data.seller?.address1) doc.text(data.seller.address1, leftMargin, y);
  if (data.buyer?.address1) doc.text(data.buyer.address1, rightCol, y);
  y += 12;

  if (data.seller?.address2) doc.text(data.seller.address2, leftMargin, y);
  if (data.buyer?.address2) doc.text(data.buyer.address2, rightCol, y);
  y += 12;

  doc.text(countryName(data.seller?.country || 'PL'), leftMargin, y);
  doc.text(countryName(data.buyer?.country || 'PL'), rightCol, y);
  y += 30;

  doc.setFont('Roboto', 'bold');
  doc.text('Szczegoly', leftMargin, y);
  y += 16;

  doc.setFont('Roboto', 'normal');
  doc.text(`Data wystawienia: ${formatDate(data.issueDate)}`, leftMargin, y);

  let saleDateLabel = '';
  if (data.periodFrom && data.periodTo) {
    saleDateLabel = `Okres: ${data.periodFrom} - ${data.periodTo}`;
  } else {
    saleDateLabel = `Data sprzedazy: ${formatDate(data.saleDate || data.issueDate)}`;
  }
  doc.text(saleDateLabel, rightCol, y);
  y += 35;

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(10);
  doc.text('Pozycje', leftMargin, y);
  y += 18;

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(102, 102, 102);
  doc.text(`Faktura wystawiona w cenach netto w walucie ${data.currency}`, leftMargin, y);
  y += 12;

  const colWidths = {
    lp: 22,
    name: 168,
    price: 55,
    qty: 35,
    unit: 35,
    vat: 45,
    net: 75,
    gross: 75,
  };

  doc.setFillColor(245, 245, 245);
  doc.rect(leftMargin, y, pageWidth, 28, 'F');
  doc.setDrawColor(153, 153, 153);
  doc.setLineWidth(0.5);
  doc.rect(leftMargin, y, pageWidth, 28);

  let colX = leftMargin;
  doc.setDrawColor(204, 204, 204);
  [colWidths.lp, colWidths.name, colWidths.price, colWidths.qty, colWidths.unit, colWidths.vat, colWidths.net].forEach(
    (w, i) => {
      if (i > 0) {
        doc.line(colX, y, colX, y + 28);
      }
      colX += w;
    }
  );

  doc.setFontSize(7);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(51, 51, 51);

  let hx = leftMargin;
  doc.text('Lp.', hx + colWidths.lp / 2, y + 16, { align: 'center' });
  hx += colWidths.lp;

  doc.text('Nazwa towaru lub uslugi', hx + 3, y + 16);
  hx += colWidths.name;

  doc.text('Cena jedn.', hx + colWidths.price - 4, y + 11, { align: 'right' });
  doc.text('netto', hx + colWidths.price - 4, y + 20, { align: 'right' });
  hx += colWidths.price;

  doc.text('Ilosc', hx + colWidths.qty - 4, y + 16, { align: 'right' });
  hx += colWidths.qty;

  doc.text('Miara', hx + colWidths.unit / 2, y + 16, { align: 'center' });
  hx += colWidths.unit;

  doc.text('Stawka', hx + colWidths.vat / 2, y + 11, { align: 'center' });
  doc.text('podatku', hx + colWidths.vat / 2, y + 20, { align: 'center' });
  hx += colWidths.vat;

  doc.text('Wartosc', hx + colWidths.net - 4, y + 7, { align: 'right' });
  doc.text('sprzedazy', hx + colWidths.net - 4, y + 14, { align: 'right' });
  doc.text('netto', hx + colWidths.net - 4, y + 21, { align: 'right' });
  hx += colWidths.net;

  doc.text('Wartosc', hx + colWidths.gross - 4, y + 7, { align: 'right' });
  doc.text('sprzedazy', hx + colWidths.gross - 4, y + 14, { align: 'right' });
  doc.text('brutto', hx + colWidths.gross - 4, y + 21, { align: 'right' });

  y += 28;

  const lineItems =
    data.lineItems?.length > 0
      ? data.lineItems
      : [
          {
            lineNumber: '1',
            name: 'Pozycja faktury',
            unitPrice: data.netAmount,
            quantity: 1,
            unit: 'SZT',
            vatRate: '23',
            netValue: data.netAmount,
            grossValue: data.grossAmount,
          },
        ];

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  lineItems.forEach((item: any) => {
    const nameLines = doc.splitTextToSize(item.name || '-', colWidths.name - 6);
    const rowHeight = Math.max(nameLines.length * 11, 18);

    doc.setDrawColor(204, 204, 204);
    doc.rect(leftMargin, y, pageWidth, rowHeight);

    let rx = leftMargin;
    [colWidths.lp, colWidths.name, colWidths.price, colWidths.qty, colWidths.unit, colWidths.vat, colWidths.net].forEach(
      (w, i) => {
        if (i > 0) {
          doc.line(rx, y, rx, y + rowHeight);
        }
        rx += w;
      }
    );

    const itemY = y + Math.max(10, (rowHeight - 8) / 2 + 4);

    let dataX = leftMargin;
    doc.text(item.lineNumber, dataX + colWidths.lp / 2, itemY, { align: 'center' });
    dataX += colWidths.lp;

    doc.text(nameLines, dataX + 3, y + 10);
    dataX += colWidths.name;

    doc.text(formatAmount(item.unitPrice), dataX + colWidths.price - 4, itemY, { align: 'right' });
    dataX += colWidths.price;

    doc.text(String(item.quantity), dataX + colWidths.qty - 4, itemY, { align: 'right' });
    dataX += colWidths.qty;

    doc.text(item.unit || 'SZT', dataX + colWidths.unit / 2, itemY, { align: 'center' });
    dataX += colWidths.unit;

    doc.text(`${item.vatRate}%`, dataX + colWidths.vat / 2, itemY, { align: 'center' });
    dataX += colWidths.vat;

    doc.text(formatAmount(item.netValue), dataX + colWidths.net - 4, itemY, { align: 'right' });
    dataX += colWidths.net;

    doc.text(formatAmount(item.grossValue), dataX + colWidths.gross - 4, itemY, { align: 'right' });

    y += rowHeight;
  });

  y += 12;

  doc.setFontSize(10);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Kwota naleznosci ogolem: ${formatAmount(data.grossAmount)} ${data.currency}`,
    555,
    y,
    { align: 'right' }
  );

  y += 22;

  doc.text('Podsumowanie stawek podatku', leftMargin, y);
  y += 16;

  const vatCols = { lp: 25, rate: 110, net: 120, vat: 120, gross: 120 };

  doc.setFillColor(245, 245, 245);
  doc.rect(leftMargin, y, pageWidth, 22, 'F');
  doc.setDrawColor(153, 153, 153);
  doc.rect(leftMargin, y, pageWidth, 22);

  let vatX = leftMargin;
  doc.setDrawColor(204, 204, 204);
  [vatCols.lp, vatCols.rate, vatCols.net, vatCols.vat].forEach((w) => {
    vatX += w;
    doc.line(vatX, y, vatX, y + 22);
  });

  doc.setFontSize(7);
  doc.setFont('Roboto', 'bold');
  doc.setTextColor(51, 51, 51);

  doc.text('Lp.', leftMargin + vatCols.lp / 2, y + 13, { align: 'center' });
  doc.text('Stawka podatku', leftMargin + vatCols.lp + 5, y + 13);
  doc.text('Kwota netto', leftMargin + vatCols.lp + vatCols.rate + vatCols.net - 6, y + 13, {
    align: 'right',
  });
  doc.text(
    'Kwota podatku',
    leftMargin + vatCols.lp + vatCols.rate + vatCols.net + vatCols.vat - 6,
    y + 13,
    { align: 'right' }
  );
  doc.text(
    'Kwota brutto',
    leftMargin + vatCols.lp + vatCols.rate + vatCols.net + vatCols.vat + vatCols.gross - 6,
    y + 13,
    { align: 'right' }
  );

  y += 22;

  const vatRowHeight = 20;
  doc.setDrawColor(204, 204, 204);
  doc.rect(leftMargin, y, pageWidth, vatRowHeight);

  vatX = leftMargin;
  [vatCols.lp, vatCols.rate, vatCols.net, vatCols.vat].forEach((w) => {
    vatX += w;
    doc.line(vatX, y, vatX, y + vatRowHeight);
  });

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  const vatRowY = y + 13;
  doc.text('1', leftMargin + vatCols.lp / 2, vatRowY, { align: 'center' });
  doc.text('23% lub 22%', leftMargin + vatCols.lp + 5, vatRowY);
  doc.text(formatAmount(data.netAmount), leftMargin + vatCols.lp + vatCols.rate + vatCols.net - 6, vatRowY, {
    align: 'right',
  });
  doc.text(
    formatAmount(data.vatAmount),
    leftMargin + vatCols.lp + vatCols.rate + vatCols.net + vatCols.vat - 6,
    vatRowY,
    { align: 'right' }
  );
  doc.text(
    formatAmount(data.grossAmount),
    leftMargin + vatCols.lp + vatCols.rate + vatCols.net + vatCols.vat + vatCols.gross - 6,
    vatRowY,
    { align: 'right' }
  );

  y += vatRowHeight + 15;

  if (data.additionalDescriptions?.length > 0) {
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('Dodatkowe informacje', leftMargin, y);
    y += 14;

    doc.setFontSize(9);
    doc.text('Dodatkowy opis', leftMargin, y);
    doc.setFont('Roboto', 'normal');
    y += 16;

    const addCols = { lp: 25, type: 180, content: 310 };

    doc.setFillColor(245, 245, 245);
    doc.rect(leftMargin, y, pageWidth, 22, 'F');
    doc.setDrawColor(153, 153, 153);
    doc.rect(leftMargin, y, pageWidth, 22);

    doc.setDrawColor(204, 204, 204);
    doc.line(leftMargin + addCols.lp, y, leftMargin + addCols.lp, y + 22);
    doc.line(leftMargin + addCols.lp + addCols.type, y, leftMargin + addCols.lp + addCols.type, y + 22);

    doc.setFontSize(7);
    doc.setFont('Roboto', 'bold');
    doc.setTextColor(51, 51, 51);

    doc.text('Lp.', leftMargin + addCols.lp / 2, y + 13, { align: 'center' });
    doc.text('Rodzaj informacji', leftMargin + addCols.lp + 5, y + 13);
    doc.text('Tresc informacji', leftMargin + addCols.lp + addCols.type + 5, y + 13);

    y += 22;

    data.additionalDescriptions.forEach((desc: any, idx: number) => {
      const descRowHeight = 18;
      doc.setDrawColor(204, 204, 204);
      doc.rect(leftMargin, y, pageWidth, descRowHeight);

      doc.line(leftMargin + addCols.lp, y, leftMargin + addCols.lp, y + descRowHeight);
      doc.line(
        leftMargin + addCols.lp + addCols.type,
        y,
        leftMargin + addCols.lp + addCols.type,
        y + descRowHeight
      );

      doc.setFont('Roboto', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);

      doc.text(String(idx + 1), leftMargin + addCols.lp / 2, y + 11, { align: 'center' });
      doc.text(desc.key || '-', leftMargin + addCols.lp + 5, y + 11);
      doc.text(desc.value || '-', leftMargin + addCols.lp + addCols.type + 5, y + 11);

      y += descRowHeight;
    });

    y += 12;
  }

  if (data.bdo) {
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('Rejestry', leftMargin, y);
    y += 14;

    doc.setFontSize(9);
    doc.text('BDO', leftMargin, y);
    doc.setFont('Roboto', 'normal');
    y += 14;

    doc.setFontSize(8);
    doc.text(data.bdo, leftMargin, y);
    y += 22;
  }

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(10);
  doc.text('Sprawdz, czy Twoja faktura znajduje sie w KSeF!', 297.5, y, {
    align: 'center',
  });

  y += 20;

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 102, 204);
  doc.text(data.verificationUrl || '-', 297.5, y, { align: 'center' });

  y += 30;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1);
  doc.rect(leftMargin + 130, y, 255, 30);

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(data.ksefNumber, 297.5, y + 18, { align: 'center' });

  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { xml, ksefNumber } = await req.json();

    if (!xml || !ksefNumber) {
      return new Response(
        JSON.stringify({ error: 'XML and ksefNumber are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const invoiceData = parseInvoiceXml(xml, ksefNumber);
    const pdfBytes = await generateInvoicePdf(invoiceData);

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="faktura-${ksefNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate PDF',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
