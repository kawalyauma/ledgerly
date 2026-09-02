import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from "react";
import {authStore,revokeSession,type Principal,type Session} from "./api";
type AuthValue={principal:Principal|null;sessionExpired:boolean;login:(s:Session,remember:boolean)=>void;logout:()=>void;dismissExpired:()=>void};
const C=createContext<AuthValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}){const [principal,setPrincipal]=useState(authStore.principal());const [sessionExpired,setExpired]=useState(false);useEffect(()=>{const f=()=>{setPrincipal(null);setExpired(true)};addEventListener("finance:session-expired",f);return()=>removeEventListener("finance:session-expired",f)},[]);return <C.Provider value={{principal,sessionExpired,login(s,r){authStore.set(s,r);setPrincipal(authStore.principal());setExpired(false)},logout(){void revokeSession();setPrincipal(null)},dismissExpired:()=>setExpired(false)}}>{children}</C.Provider>}
export const useAuth=()=>{const v=useContext(C);if(!v)throw new Error("AuthProvider missing");return v};
export function usePermission(scope:string){const {principal}=useAuth();return useMemo(()=>!!principal&&(principal.role==="owner"||principal.role==="admin"||principal.scopes.includes(scope)),[principal,scope])}
