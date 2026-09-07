import { useEffect,useState } from "react";
import { HandCoins } from "lucide-react";
import { ApiError,can,get,post } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Button,Spinner } from "../../../web/components/ui";
import { PaymentsPage } from "../../../web/pages/FinanceOperationsPages";
import { PayrollPage } from "../../../web/pages/TaxPayrollPages";
export function PayrollPaymentsPage({view}:{view:"payroll"|"payments"}){const{principal}=useAuth(),[state,setState]=useState<"loading"|"ready"|"disabled">("loading");const check=async()=>{try{await get(`/${view}/manifest`);setState("ready")}catch(e){if(e instanceof ApiError&&e.code==="MODULE_DISABLED")setState("disabled");else throw e}};useEffect(()=>{void check()},[principal?.organizationId,view]);if(state==="loading")return <div className="page"><Spinner label="Loading Payroll & Payments"/></div>;if(state==="disabled")return <div className="page"><div className="hr-empty"><HandCoins size={42}/><h1>Payroll & Payments</h1><p>Enable this standalone module to process payroll and organization payments using your enabled people and finance modules.</p>{can(principal,"admin:write")&&<Button onClick={async()=>{await post("/modules/payroll-payments/enable",{configuration:{}});await check()}}>Enable Payroll & Payments</Button>}</div></div>;return view==="payroll"?<PayrollPage/>:<PaymentsPage/>}
