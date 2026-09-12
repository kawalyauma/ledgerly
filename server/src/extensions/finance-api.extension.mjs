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
const cutover=(env,primary,legacy)=>mode(env[primary]??(legacy?env[legacy]:undefined),primary);

export default{
  name:'finance-api',required:false,
  configure(env){
    const referenceLegacy=mode(env.LEDGERLY_FINANCE_REFERENCE_CUTOVER,'LEDGERLY_FINANCE_REFERENCE_CUTOVER');
    const documentsLegacy=mode(env.LEDGERLY_FINANCE_DOCUMENTS_CUTOVER,'LEDGERLY_FINANCE_DOCUMENTS_CUTOVER');
    const paymentsLegacy=mode(env.LEDGERLY_FINANCE_PAYMENTS_CUTOVER,'LEDGERLY_FINANCE_PAYMENTS_CUTOVER');
    const journalsLegacy=mode(env.LEDGERLY_FINANCE_JOURNALS_CUTOVER,'LEDGERLY_FINANCE_JOURNALS_CUTOVER');
    const feesLegacy=mode(env.LEDGERLY_SCHOOL_FEES_CUTOVER,'LEDGERLY_SCHOOL_FEES_CUTOVER');
    const payrollLegacy=mode(env.LEDGERLY_PAYROLL_CUTOVER,'LEDGERLY_PAYROLL_CUTOVER');
    return{
      referenceCutover:referenceLegacy,
      referenceReadCutover:cutover(env,'LEDGERLY_FINANCE_REFERENCE_READ_CUTOVER','LEDGERLY_FINANCE_REFERENCE_CUTOVER'),
      referenceWriteCutover:cutover(env,'LEDGERLY_FINANCE_REFERENCE_WRITE_CUTOVER','LEDGERLY_FINANCE_REFERENCE_CUTOVER'),
      documentsCutover:documentsLegacy,
      documentsReadCutover:cutover(env,'LEDGERLY_FINANCE_DOCUMENTS_READ_CUTOVER','LEDGERLY_FINANCE_DOCUMENTS_CUTOVER'),
      documentsWriteCutover:cutover(env,'LEDGERLY_FINANCE_DOCUMENTS_WRITE_CUTOVER','LEDGERLY_FINANCE_DOCUMENTS_CUTOVER'),
      paymentsCutover:paymentsLegacy,
      paymentsReadCutover:cutover(env,'LEDGERLY_FINANCE_PAYMENTS_READ_CUTOVER','LEDGERLY_FINANCE_PAYMENTS_CUTOVER'),
      paymentsWriteCutover:cutover(env,'LEDGERLY_FINANCE_PAYMENTS_WRITE_CUTOVER','LEDGERLY_FINANCE_PAYMENTS_CUTOVER'),
      journalsCutover:journalsLegacy,
      journalsReadCutover:cutover(env,'LEDGERLY_FINANCE_JOURNALS_READ_CUTOVER','LEDGERLY_FINANCE_JOURNALS_CUTOVER'),
      journalsWriteCutover:cutover(env,'LEDGERLY_FINANCE_JOURNALS_WRITE_CUTOVER','LEDGERLY_FINANCE_JOURNALS_CUTOVER'),
      reversalsWriteCutover:cutover(env,'LEDGERLY_FINANCE_REVERSALS_WRITE_CUTOVER'),
      bankingCutover:mode(env.LEDGERLY_FINANCE_BANKING_CUTOVER,'LEDGERLY_FINANCE_BANKING_CUTOVER'),
      taxCutover:mode(env.LEDGERLY_FINANCE_TAX_CUTOVER,'LEDGERLY_FINANCE_TAX_CUTOVER'),
      approvalsCutover:mode(env.LEDGERLY_FINANCE_APPROVALS_CUTOVER,'LEDGERLY_FINANCE_APPROVALS_CUTOVER'),
      reportsCutover:mode(env.LEDGERLY_FINANCE_REPORTS_CUTOVER,'LEDGERLY_FINANCE_REPORTS_CUTOVER'),
      dashboardCutover:mode(env.LEDGERLY_FINANCE_DASHBOARD_CUTOVER,'LEDGERLY_FINANCE_DASHBOARD_CUTOVER'),
      feesCutover:feesLegacy,
      schoolFeesReadCutover:cutover(env,'LEDGERLY_SCHOOL_FEES_READ_CUTOVER','LEDGERLY_SCHOOL_FEES_CUTOVER'),
      schoolFeesWriteCutover:cutover(env,'LEDGERLY_SCHOOL_FEES_WRITE_CUTOVER','LEDGERLY_SCHOOL_FEES_CUTOVER'),
      schoolFeesReversalCutover:cutover(env,'LEDGERLY_SCHOOL_FEES_REVERSAL_CUTOVER'),
      payrollCutover:payrollLegacy,
      payrollReadCutover:cutover(env,'LEDGERLY_PAYROLL_READ_CUTOVER','LEDGERLY_PAYROLL_CUTOVER'),
      payrollWriteCutover:cutover(env,'LEDGERLY_PAYROLL_WRITE_CUTOVER','LEDGERLY_PAYROLL_CUTOVER'),
      payrollReversalCutover:cutover(env,'LEDGERLY_PAYROLL_REVERSAL_CUTOVER')
    };
  },
  enabled(){return true},
  async create({services,extensionConfig}){
    const shared={database:services.database,cache:services.cache};
    const reversals=new FinanceReversalService(shared);
    const financeTransactions=new FinanceTransactions({database:services.database,sourceReversalHandlers:new Map([['payment',paymentReversalHandler()],['school_fee_receipt',schoolFeeReceiptReversalHandler()],['school-fees',schoolFeeReceiptReversalHandler()],['payroll',payrollRunReversalHandler()]])});
    const payrollTransactions=new PayrollTransactions({database:services.database});
    const payrollTransactional=new PayrollTransactionalService({services,finance:financeTransactions,payrollTx:payrollTransactions});
    const payrollManagement=new PayrollManagementService({database:services.database,cache:services.cache,reversals});
    return{value:Object.freeze({accounts:new FinanceAccountsService(shared),accountsExtra:new FinanceAccountsExtraService(shared),journals:new FinanceJournalsService(shared),payments:new FinancePaymentsService(shared),paymentsRead:new FinancePaymentsReadService(shared),reversals,core:new CoreFinanceService({services,finance:financeTransactions}),schoolFees:new SchoolFeesApiService({services}),payroll:payrollTransactional,payrollManagement,banking:new BankingApiService(shared),tax:new TaxApiService({database:services.database}),approvals:new FinanceApprovalService({services}),reports:new FinanceReportsReadService({database:services.database}),dashboard:new FinanceDashboardService(shared),...extensionConfig}),async readiness(){return{ok:true,...extensionConfig}},describe(){return{...extensionConfig,cloudflareFallback:true,granularRoutes:true,tenantCache:true,dashboardCache:true,schoolFeesTransactional:true,payrollTransactional:true,payrollManagement:true,bankingTransactional:true,taxTransactional:true,approvalsTransactional:true,reportReadsPostgres:true}}};
  }
};
