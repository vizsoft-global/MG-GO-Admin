// Throwaway: sets only the e-sign keys this pass needs, in both locales, preserving everything else.
const fs = require('fs');

const PATCH = {
  en: {
    'sent.fieldDocument': 'Document to sign',
    'sent.fieldDocumentHint': 'PDF, PNG or JPG up to 10 MB. WebP is not supported by the signed-copy composer.',
    'sent.errors.missingFields': 'Driver, title and document are required',
    'sent.errors.uploadFailed': 'Could not upload the document',
    'sent.errors.unsupported_source_type': 'Unsupported file type — upload a PDF, PNG or JPG',
    'sent.errors.file_too_large': 'File is larger than 10 MB',
    'signatures.title': 'E-Signatures',
    'detail.print': 'Print',
    'detail.downloadDocument': 'Download original document',
    'detail.downloadSignedCopy': 'Download signed document',
    'detail.proof.signed_at': 'Date / time',
    'categories.iconSlot': 'Icon slot',
  },
  ar: {
    'sent.fieldDocument': 'المستند المطلوب توقيعه',
    'sent.fieldDocumentHint': 'PDF أو PNG أو JPG بحجم أقصى 10 ميجابايت. صيغة WebP غير مدعومة في تركيب النسخة الموقعة.',
    'sent.errors.missingFields': 'السائق والعنوان والمستند مطلوبة',
    'sent.errors.uploadFailed': 'تعذر رفع المستند',
    'sent.errors.unsupported_source_type': 'نوع ملف غير مدعوم — ارفع ملف PDF أو PNG أو JPG',
    'sent.errors.file_too_large': 'حجم الملف أكبر من 10 ميجابايت',
    'signatures.title': 'التوقيعات الإلكترونية',
    'detail.print': 'طباعة',
    'detail.downloadDocument': 'تنزيل المستند الأصلي',
    'detail.downloadSignedCopy': 'تنزيل المستند الموقّع',
    'detail.proof.signed_at': 'التاريخ / الوقت',
    'categories.iconSlot': 'رمز الأيقونة',
  },
};

for (const [locale, patch] of Object.entries(PATCH)) {
  const file = `src/messages/${locale}.json`;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = json.pages.requests.esign;
  for (const [dotted, value] of Object.entries(patch)) {
    const parts = dotted.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node[part] = node[part] || {};
      node = node[part];
    }
    node[parts[parts.length - 1]] = value;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log('patched', file, Object.keys(patch).length, 'keys');
}
