import { AlertTriangle, ScanText } from 'lucide-react';
import type { HealthRecord, Language } from '../../shared/types';

export function needsOcrAcknowledgment(record: HealthRecord) {
  const ocr = record.provenance.ocr;
  const unclear = /\[(?:unclear|illegible|unreadable|unknown)[^\]]*\]|अस्पष्ट|अपठनीय/i;
  return !!ocr && (ocr.status !== 'agreement' || ocr.disagreementCount > 0 || unclear.test(record.sourceText) || ocr.pages.some(page => unclear.test(page.consensus)) || record.provenance.warnings.some(warning => warning.startsWith('Evidence-only draft:')));
}

export default function OcrReview({record,language,acknowledged,onAcknowledge,showPasses=false}: {
  record: HealthRecord; language: Language; acknowledged: boolean; onAcknowledge: (value:boolean)=>void; showPasses?:boolean;
}) {
  const ocr=record.provenance.ocr;
  if(!ocr)return null;
  const t=(en:string,hi:string)=>language==='hi'?hi:en;
  const needsReview=needsOcrAcknowledgment(record);
  return <section className={`ocr-review ${needsReview?'ocr-review-warning':''}`} aria-label={t('OCR review','OCR समीक्षा')}>
    <div className="ocr-review-title">{needsReview?<AlertTriangle size={19}/>:<ScanText size={19}/>}<div><h3>{needsReview?t('OCR needs your attention','OCR को आपकी जाँच चाहिए'):ocr.mode==='verified'?t('Two OCR passes compared','दो OCR पाठ की तुलना हुई'):t('Image text extracted','इमेज का टेक्स्ट निकाला गया')}</h3>
    <p>{needsReview?t('Unclear text stays blank. Check medicine names, decimal points and doses against the original. Ask the prescriber when handwriting is unreadable.','अस्पष्ट जानकारी खाली रहेगी। दवा के नाम, दशमलव और खुराक मूल पर्चे से मिलाएँ। लिखावट समझ न आए तो डॉक्टर से पूछें।'):t('Matching OCR readings are not proof of accuracy. Review names and doses against the original document.','OCR के पाठ मिलना सटीकता का प्रमाण नहीं है। नाम और खुराक मूल दस्तावेज़ से जाँचें।')}</p></div></div>
    {needsReview&&<label className="ocr-acknowledgment"><input type="checkbox" checked={acknowledged} onChange={e=>onAcknowledge(e.target.checked)}/><span>{t('I compared the unclear text with the original and checked any uncertain medicine or dose with the prescriber.','मैंने अस्पष्ट टेक्स्ट मूल से मिलाया है और अनिश्चित दवा या खुराक डॉक्टर से जाँची है।')}</span></label>}
    {showPasses&&ocr.pages.map(page=><details className="ocr-page" key={page.page} open><summary>{t('Page','पृष्ठ')} {page.page} · {page.disagreementCount} {t('disputed text segments','अलग पाठ के अंश')}</summary><div className="ocr-pass-grid"><div><strong>{t('First reading','पहला पाठ')}</strong><pre>{page.firstPass}</pre></div><div><strong>{t('Second reading','दूसरा पाठ')}</strong><pre>{page.secondPass||t('Verification unavailable','दूसरी जाँच उपलब्ध नहीं')}</pre></div></div><strong className="ocr-consensus-label">{t('Text used for extraction','जानकारी निकालने में इस्तेमाल टेक्स्ट')}</strong><pre className="ocr-consensus">{page.consensus}</pre></details>)}
  </section>;
}
