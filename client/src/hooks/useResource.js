import {useState,useEffect,useCallback} from 'react';
import {api} from '../services/api.js';
// Key results to the request so changing a URL never briefly renders another page's rows.
export function useResource(path){
 const [version,setVersion]=useState(0),[state,setState]=useState({path:null,version:-1,data:null,error:'',loading:true});
 const reload=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{
 const c=new AbortController();setState({path,version,data:null,error:'',loading:true});
 api(path,{signal:c.signal}).then(data=>{if(!c.signal.aborted)setState({path,version,data,error:'',loading:false});})
 .catch(e=>{if(!c.signal.aborted)setState({path,version,data:null,error:e.message,loading:false});});
 return ()=>c.abort();
 },[path,version]);
 const current=state.path===path&&state.version===version?state:{data:null,error:'',loading:true};
 return {data:current.data,error:current.error,loading:current.loading,reload};
}
