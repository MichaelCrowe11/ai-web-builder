import { renderDocumentFull } from "./renderer";
import { assignVariant, type Experiment } from "@shared/experiment";
import { patchSection, sectionKey, type SiteDocument } from "@shared/site-document";

export function assembleDocumentHtml(
  doc: SiteDocument,
  siteId: string,
  exp: Experiment | null,
  visitorId: string,
): string {
  let active = doc;
  let experimentId: string | undefined;
  let variantId: string | undefined;

  if (exp && exp.status === "running") {
    const variant = assignVariant(exp, visitorId);
    experimentId = exp.id;
    variantId = variant.id;
    if (variant.patch) active = patchSection(doc, exp.targetSectionId, variant.patch);
  }

  const keys = active.sections.map((_, i) => sectionKey(active, i));
  const html = renderDocumentFull(active);
  const ctx = JSON.stringify({
    siteId,
    experimentId,
    variantId,
    conversionEvent: exp?.conversionEvent,
  });
  return html.replace("</body>", `${beacon(ctx, keys)}\n${formCapture(siteId)}\n</body>`);
}

/** Capture contact/booking form submissions to the owner's inbox (replaces mailto). */
function formCapture(siteId: string): string {
  return `<script>(function(){
  document.querySelectorAll('form.contact-form').forEach(function(f){
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var data={};new FormData(f).forEach(function(v,k){data[k]=v;});
      fetch('/api/forms/${siteId}/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){if(!r.ok)throw 0;return r;})
        .then(function(){f.innerHTML='<p style="padding:1.2rem 0;font-size:1.05rem;color:var(--ink)">Thanks! We got your message and will be in touch.</p>';})
        .catch(function(){var a=f.getAttribute('action');if(a&&a.indexOf('mailto:')===0)window.location.href=a;});
    });
  });
  })();</script>`;
}

/** First-party telemetry beacon. No third-party trackers, no PII. */
function beacon(ctx: string, keys: string[]): string {
  return `<script>(function(){
  var CTX = ${ctx}; var KEYS = ${JSON.stringify(keys)};
  function vid(){var m=document.cookie.match(/(?:^|; )vid=([^;]+)/);if(m)return m[1];var v='v'+Math.random().toString(36).slice(2)+Date.now().toString(36);document.cookie='vid='+v+';path=/;max-age=31536000;samesite=lax';return v;}
  var V=vid(), S='s'+Math.random().toString(36).slice(2), Q=[];
  function push(type,sectionId){Q.push({siteId:CTX.siteId,visitorId:V,sessionId:S,ts:Date.now(),type:type,sectionId:sectionId,experimentId:CTX.experimentId,variantId:CTX.variantId});}
  function flush(){if(!Q.length)return;try{navigator.sendBeacon('/api/t',JSON.stringify(Q.splice(0,Q.length)));}catch(e){}}
  push('pageview');
  var secs=document.querySelectorAll('[data-section-key]');
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){push('section_view',e.target.getAttribute('data-section-key'));io.unobserve(e.target);}});},{threshold:0.4});secs.forEach(function(s){io.observe(s);});}
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a,button');if(!a)return;var sec=a.closest('[data-section-key]');push('cta_click',sec&&sec.getAttribute('data-section-key'));if(CTX.conversionEvent&&a.getAttribute('data-conversion')){push('conversion', sec&&sec.getAttribute('data-section-key'));}flush();});
  ['visibilitychange','pagehide'].forEach(function(ev){document.addEventListener(ev,flush);});
  setInterval(flush,5000);
  })();</script>`;
}
