import{useEffect,useState,type ReactNode}from"react";
import{BarChart3,Bell,ChevronDown,ChevronRight,LogOut,Menu,Search,X}from"lucide-react";
import{get,post,can,type Principal,type Session}from"../api";
import{useAuth}from"../auth";
import{appGlobalActions,appNavigation}from"../../modules/frontend-registry";
import type{FrontendGlobalAction as GlobalAction,FrontendNavigationGroup as Group,FrontendNavigationItem as Item}from"../../modules/frontend-types";

const allowed=(i:Item,p:Principal|null)=>(!i.scope||can(p,i.scope))&&(!i.admin||!!p&&["owner","admin"].includes(p.role));
const actionAllowed=(a:GlobalAction,p:Principal|null)=>(!a.scope||can(p,a.scope))&&(!a.admin||!!p&&["owner","admin"].includes(p.role));

function NavGroup({group,active,principal,onNavigate}:{group:Group;active:string;principal:Principal|null;onNavigate:(p:string)=>void}){
 const items=group.items.filter(i=>allowed(i,principal)),hasActive=items.some(i=>i.path===active),[open,setOpen]=useState(hasActive);
 useEffect(()=>{if(hasActive)setOpen(true)},[hasActive]);
 if(!items.length)return null;const Icon=group.icon;
 if(items.length===1)return <button className={`nav-parent ${hasActive?"active":""}`} onClick={()=>onNavigate(items[0]!.path)}><Icon size={18}/><span>{group.label}</span></button>;
 return <div className={`nav-group ${hasActive?"current":""}`}><button className="nav-parent" aria-expanded={open} onClick={()=>setOpen(!open)}><Icon size={18}/><span>{group.label}</span>{open?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>{open&&<div className="nav-children">{items.map(i=><button key={`${i.path}-${i.label}`} className={i.path===active?"active":""} onClick={()=>onNavigate(i.path)}><span>{i.label}</span></button>)}</div>}</div>;
}

type Org={id:string;name:string};
export function AppShell({children,active,onNavigate}:{children:ReactNode;active:string;onNavigate:(p:string)=>void}){
 const[mobile,setMobile]=useState(false),[account,setAccount]=useState(false),[orgs,setOrgs]=useState<Org[]>([]),[switching,setSwitching]=useState(false),[name,setName]=useState("Current user"),[chatUnread,setChatUnread]=useState(0);
 const{principal,login,logout}=useAuth(),schoolMode=active==="school",workMode=active==="work",examMode=active==="exams",communicationsMode=active==="communications",academicsMode=active==="academics",attendanceMode=active==="attendance",focusedMode=schoolMode||workMode||examMode||communicationsMode||academicsMode||attendanceMode;
 useEffect(()=>{get<Org[]>("/organizations").then(setOrgs).catch(()=>{});if(can(principal,"admin:read"))get<Array<{userId:string;displayName:string}>>("/admin/memberships").then(x=>setName(x.find(m=>m.userId===principal?.userId)?.displayName||"Current user")).catch(()=>{})},[principal]);
 useEffect(()=>{const load=()=>get<{unread:number}>("/work/chats").then(x=>setChatUnread(x.unread)).catch(()=>{});load();const timer=setInterval(load,15000);return()=>clearInterval(timer)},[principal,active]);
 async function switchOrg(id:string){if(id===principal?.organizationId)return;setSwitching(true);try{const s=await post<Session>("/organizations/switch",{organizationId:id});localStorage.setItem("finance.activeOrganization",id);login(s,localStorage.getItem("finance.remember")!=="false");location.reload()}finally{setSwitching(false)}}
 const navigate=(p:string)=>{onNavigate(p);setMobile(false)};
 return <div className={`app-shell ${focusedMode?"app-shell--school":""}`}>
  {!focusedMode&&mobile&&<button className="scrim" aria-label="Close navigation" onClick={()=>setMobile(false)}/>} 
  {!focusedMode&&<aside className={`sidebar modern-sidebar ${mobile?"sidebar--open":""}`}>
   <div className="brand"><span className="brand__mark"><BarChart3 size={20}/></span><span>ledgerly</span><button className="mobile-close" onClick={()=>setMobile(false)}><X size={19}/></button></div>
   <div className="org-switch"><span>Workspace</span><select aria-label="Active organization" disabled={switching} value={principal?.organizationId||""} onChange={e=>void switchOrg(e.target.value)}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></div>
   <nav className="nav-list modern-nav" aria-label="Main navigation">{appNavigation.map(g=><NavGroup key={`${g.order??100}-${g.label}`} group={g} active={active} principal={principal} onNavigate={navigate}/>)}</nav>
   <div className="sidebar-footer"><small>Ledgerly workspace</small><span>API v1 · Connected</span></div>
  </aside>}
  <div className="workspace">
   <header className="topbar">
    {focusedMode?<button className="school-ledgerly-back" onClick={()=>navigate("dashboards")}><BarChart3 size={18}/><span>Ledgerly</span></button>:<button className="menu-button" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button>}
    <label className="global-search"><Search size={18}/><input placeholder={schoolMode?"Search school workspace…":workMode?"Search tasks & work…":examMode?"Search examinations…":communicationsMode?"Search messages & notifications…":academicsMode?"Search academics…":attendanceMode?"Search attendance…":"Search workspace…"}/></label>
    <div className="topbar__actions">
     {appGlobalActions.filter(a=>actionAllowed(a,principal)).map(action=>{const Action=action.component;return <Action key={action.key} activePath={active}/>})}
     <button className="icon-button app-chat-bell" aria-label={`${chatUnread} unread chat messages`} onClick={()=>{sessionStorage.setItem("ledgerly.work.view","chats");navigate("work")}}><Bell size={19}/>{chatUnread>0&&<b>{chatUnread>99?"99+":chatUnread}</b>}</button>
     <div className="account-wrap"><button className="profile" onClick={()=>setAccount(!account)}><span className="avatar">{name.slice(0,2).toUpperCase()}</span><span><strong>{name}</strong><small>{principal?.role}</small></span><ChevronDown size={14}/></button>{account&&<div className="account-menu"><p><b>{principal?.role}</b><small>{principal?.scopes.length?principal.scopes.join(", "):"Full organization access"}</small></p><button onClick={logout}><LogOut size={15}/> Log out</button></div>}</div>
    </div>
   </header>
   <main>{children}</main>
  </div>
 </div>;
}
