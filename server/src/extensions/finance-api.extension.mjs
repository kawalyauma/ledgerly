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
import {PayrollApiService as PayrollTransactionalService,payrollRunReversalHandler} from '../finance/payroll-cutover-service.mjs';
import {PayrollApiService as PayrollManagementService} from '../finance/payroll-api-service.mjs';
import {BankingApiService} from '../finance/banking-api-service.mjs';
import {TaxApiService} from '../finance/tax-api-service.mjs';
import {FinanceApprovalService} from '../finance/approval-service.mjs';
import {FinanceReportsReadService} from '../finance/reports-read-service.mjs';
import {FinanceDashboardService} from '../finance/dashboard-service.mjs';
const MODES=new Set(['cloudflare','shadow','node']);
const mode=(value,name)=>{const v=String(value||'cloudflare').toLowerCase();if(!MODES.has(v))throw new Error(`${name} must be cloudflare, shadow, or node`);return v};
export default{
 name:'finance-api',required:false,
 configure(env){return{referenceCutover:mode(env.LEDGERLY_FINANCE_REFERENCE_CUTOVER,'LEDGERLY_FINANCE_REFERENCE_CUTOVER'),journalsCutover:mode(env.LEDGERLY_FINANCE_JOURNALS_CUTOVER,'LEDGERLY_FINANCE_JOURNALS_CUTOVER'),documentsCutover:mode(env.LEDGERLY_FINANCE_DOCUMENTS_CUTOVER,'LEDGERLY_FINANCE_DOCUMENTS_CUTOVER'),paymentsCutover:mode(env.LEDGERLY_FINANCE_PAYMENTS_CUTOVER,'LEDGERLY_FINANCE_PAYMENTS_CUTOVER'),bankingCutover:mode(env.LEDGERLY_FINANCE_BANKING_CUTOVER,'LEDGERLY_FINANCE_BANKING_CUTOVER'),taxCutover:mode(env.LEDGERLY_FINANCE_TAX_CUTOVER,'LEDGERLY_FINANCE_TAX_CUTOVER'),approvalsCutover:mode(env.LEDGERLY_FINANCE_APPROVALS_CUTOVER,'LEDGERLY_FINANCE_APPROVALS_CUTOVER'),reportsCutover:mode(env.LEDGERLY_FINANCE_REPORTS_CUTOVER,'LEDGERLY_FINANCE_REPORTS_CUTOVER'),dashboardCutover:mode(env.LEDGERLY_FINANCE_DASHBOARD_CUTOVER,'LEDGERLY_FINANCE_DASHBOARD_CUTOVER'),feesCutover:mode(env.LEDGERLY_SCHOOL_FEES_CUTOVER,'LEDGERLY_SCHOOL_FEES_CUTOVER'),payrollCutover:mode(env.LEDGERLY_PAYROLL_CUTOVER,'LEDGERLY_PAYROLL_CUTOVER')};},
 enabled(){return true},
 async create({services,extensionConfig}){const shared={database:services.database,cache:services.cache},reversals=new FinanceReversalService(shared),financeTransactions=new FinanceTransactions({database:services.database,sourceReversalHandlers:new Map([['payment',paymentReversalHandler()],['school_fee_receipt',schoolFeeReceiptReversalHandler()],['school-fees',schoolFeeReceiptReversalHandler()],['payroll',payrollRunReversalHandler()]])}),payrollTransactions=new PayrollTransactions({database:services.database}),payrollTransactional=new PayrollTransactionalService({services,finance:financeTransactions,payrollTx:payrollTransactions}),payrollManagement=new PayrollManagementService({database:services.database,cache:services.cache,reversals});return{value:Object.freeze({accounts:new FinanceAccountsService(shared),accountsExtra:new FinanceAccountsExtraService(shared),journals:new FinanceJournalsService(shared),payments:new FinancePaymentsService(shared),paymentsRead:new FinancePaymentsReadService(shared),reversals,core:new CoreFinanceService({services,finance:financeTransactions}),schoolFees:new SchoolFeesApiService({services}),payroll:payrollTransactional,payrollManagement,banking:new BankingApiService(shared),tax:new TaxApiService({database:services.database}),approvals:new FinanceApprovalService({services}),reports:new FinanceReportsReadService({database:services.database}),dashboard:new FinanceDashboardService(shared),...extensionConfig}),async readiness(){return{ok:true,...extensionConfig}},describe(){return{...extensionConfig,cloudflareFallback:true,granularRoutes:true,tenantCache:true,dashboardCache:true,schoolFeesTransactional:true,payrollTransactional:true,payrollManagement:true,bankingTransactional:true,taxTransactional:true,approvalsTransactional:true,reportReadsPostgres:true}}}}
};
