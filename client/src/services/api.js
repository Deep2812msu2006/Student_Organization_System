let token;
export class ApiError extends Error {
  constructor(status, error) { super(error?.message || 'The request failed. Please try again.'); this.status=status; this.fields=error?.fields || {}; }
}
export function setCsrf(value) { token=value; }
export async function api(path,{method='GET',body,signal,headers={}}={}) {
  if (method !== 'GET' && !token) {
    const result=await api('/auth/csrf'); token=result.data.csrfToken;
  }
  let response;
  try { response=await fetch(`/api/v1${path}`,{method,signal,credentials:'same-origin',headers:{...headers,Accept:'application/json',...(body ? {'Content-Type':'application/json'} : {}),...(method!=='GET' ? {'X-CSRF-Token':token} : {})},...(body ? {body:JSON.stringify(body)} : {})}); }
  catch(error) { if(error.name==='AbortError') throw error; throw new Error('Cannot reach the server. Check the connection and try again.'); }
  if(response.status===204) return null;
  let result;
  try { result=await response.json(); } catch(error) { if(error.name==='AbortError') throw error; throw new Error('The server returned an invalid response. Please try again.'); }
  if(!response.ok) {
    if(result.error?.code==='CSRF_INVALID') token=null;
    throw new ApiError(response.status,result.error);
  }
  return result;
}
