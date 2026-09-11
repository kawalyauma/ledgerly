import {FinanceAccountsService} from '../finance/accounts-service.mjs';
import {FinanceAccountsExtraService} from '../finance/accounts-extra-service.mjs';
import {FinanceJournalsService} from '../finance/journals-service.mjs';
import {FinancePaymentsService} from '../finance/payments-service.mjs';
import {FinancePaymentsReadService} from '../finance/payments-read-service.mjs';
import {FinanceReversalService} from '../finance/reversal-service.mjs';
const MODES=new Set(['cloudflare','shadow','node']);
const mode=(value,name)=>{const v=String(value||'cloudflare').toLowerCase();if(!MODES.has(v))throw new Error(`${name} must be cloudflare, shadow, or node`);return v};
export default{
 name:'finance-api',required:false,
 configure(env){return{referenceCutover:mode(env.LEDGERLY_FINANCE_REFERENCE_CUTOVER,'LEDGERLY_FINANCE_REFERENCE_CUTOVER'),journalsCutover:mode(env.LEDGERLY_FINANCE_JOURNALS_CUTOVER,'LEDGERLY_FINANCE_JOURNALS_CUTOVER'),paymentsCutover:mode(env.LEDGERLY_FINANCE_PAYMENTS_CUTOVER,'LEDGERLY_FINANCE_PAYMENTS_CUTOVER'),feesCutover:mode(env.LEDGERLY_SCHOOL_FEES_CUTOVER,'LEDGERLY_SCHOOL_FEES_CUTOVER'),payrollCutover:mode(env.LEDGERLY_PAYROLL_CUTOVER,'LEDGERLY_PAYROLL_CUTOVER')};},
 enabled(){return true},
 async create({services,extensionConfig}){const shared={database:services.database,cache:services.cache};return{value:Object.freeze({accounts:new FinanceAccountsService(shared),accountsExtra:new FinanceAccountsExtraService(shared),journals:new FinanceJournalsService(shared),payments:new FinancePaymentsService(shared),paymentsRead:new FinancePaymentsReadService(shared),reversals:new FinanceReversalService(shared),...extensionConfig}),async readiness(){return{ok:true,...extensionConfig}},describe(){return{...extensionConfig,cloudflareFallback:true,granularRoutes:true}}}}
};
