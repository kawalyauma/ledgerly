import {FinanceAccountsService} from '../finance/accounts-service.mjs';
import {FinanceAccountsExtraService} from '../finance/accounts-extra-service.mjs';
import {FinanceJournalsService} from '../finance/journals-service.mjs';
import {FinancePaymentsService} from '../finance/payments-service.mjs';
import {FinancePaymentsReadService} from '../finance/payments-read-service.mjs';
import {FinanceReversalService} from '../finance/reversal-service.mjs';
import {FinanceTransactions} from '../finance/transactions.mjs';
import {PayrollTransactions} from '../finance/payroll-transactions.mjs';
import {schoolFeeReceiptReversalHandler} from '../finance/school-fees-reversal.mjs';
import {CoreFinanceService,paymentReversalHandler} from '../finance/core-api-service.mjs';
import {SchoolFeesApiService} from '../finance/school-fees-api-service.mjs';
import {PayrollApiService as PayrollCutoverService,payrollRunReversalHandler} from '../finance/payroll-cutover-service.mjs';
const MODES=new Set(['cloudflare','shadow','node']);
const mode=(value,name)=>{const v=String(value||'cloudflare').toLowerCase();if(!MODES.has(v))throw new Error(`${name} must be cloudflare, shadow, or node`);return v};
export default{
 name:'finance-api',required:false,
 configure(env){return{referenceCutover:mode(env.LEDGERLY_FINANCE_REFERENCE_CUTOVER,'LEDGERLY_FINANCE_REFERENCE_CUTOVER'),journalsCutover:mode(env.LEDGERLY_FINANCE_JOURNALS_CUTOVER,'LEDGERLY_FINANCE_JOURNALS_CUTOVER'),documentsCutover:mode(env.LEDGERLY_FINANCE_DOCUMENTS_CUTOVER,'LEDGERLY_FINANCE_DOCUMENTS_CUTOVER'),paymentsCutover:mode(env.LEDGERLY_FINANCE_PAYMENTS_CUTOVER,'LEDGERLY_FINANCE_PAYMENTS_CUTOVER'),feesCutover:mode(env.LEDGERLY_SCHOOL_FEES_CUTOVER,'LEDGERLY_SCHOOL_FEES_CUTOVER'),payrollCutover:mode(env.LEDGERLY_PAYROLL_CUTOVER,'LEDGERLY_PAYROLL_CUTOVER')};},
 enabled(){return true},
 async create({services,extensionConfig}){const shared={database:services.database,cache:services.cache},reversals=new FinanceReversalService(shared),financeTransactions=new FinanceTransactions({database:services.database,sourceReversalHandlers:new Map([['payment',paymentReversalHandler()],['school_fee_receipt',schoolFeeReceiptReversalHandler()],['school-fees',schoolFeeReceiptReversalHandler()],['payroll',payrollRunReversalHandler()]])}),payrollTransactions=new PayrollTransactions({database:services.database});return{value:Object.freeze({accounts:new FinanceAccountsService(shared),accountsExtra:new FinanceAccountsExtraService(shared),journals:new FinanceJournalsService(shared),payments:new FinancePaymentsService(shared),paymentsRead:new FinancePaymentsReadService(shared),reversals,core:new CoreFinanceService({services,finance:financeTransactions}),schoolFees:new SchoolFeesApiService({services}),payroll:new PayrollCutoverService({services,finance:financeTransactions,payrollTx:payrollTransactions}),...extensionConfig}),async readiness(){return{ok:true,...extensionConfig}},describe(){return{...extensionConfig,cloudflareFallback:true,granularRoutes:true,tenantCache:true,schoolFeesTransactional:true,payrollTransactional:true}}}}
};
