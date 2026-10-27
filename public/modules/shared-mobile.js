// 開通人員時，若手機號碼已在其他公司使用（兼職），伺服器回 409 needs_confirm=shared_mobile。
// 這裡統一跳出確認，按「確定」就帶 confirm_shared_mobile 再送一次；不透露是哪一家公司。
(function(){
  if(window.__sharedMobileFetch)return;window.__sharedMobileFetch=true;
  const orig=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const res=await orig(input,init);
    if(res.status!==409||!init||typeof init.body!=='string')return res;
    let d=null;try{d=await res.clone().json();}catch{return res;}
    if(!d||d.needs_confirm!=='shared_mobile')return res;
    let body;try{body=JSON.parse(init.body);}catch{return res;}
    if(!confirm(d.error||'該號碼已有帳號使用中，是否繼續開通該人員（才可使用本公司開通之社區）')){
      return new Response(JSON.stringify({error:'已取消開通'}),{status:400,headers:{'Content-Type':'application/json'}});
    }
    body.confirm_shared_mobile=true;
    return orig(input,{...init,body:JSON.stringify(body)});
  };
})();
