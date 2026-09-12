const states=new Set(['cloudflare','shadow','node']);
const defaults=Object.freeze({
  'auth.login':'cloudflare','auth.register':'cloudflare','organizations.read':'cloudflare','organizations.write':'cloudflare',
  'platform.modules':'cloudflare','contacts.core':'cloudflare','communications.core':'cloudflare','attendance.core':'cloudflare','academics.core':'cloudflare',
  'school.reference.read':'cloudflare','school.reference.write':'cloudflare','school.people.read':'cloudflare','school.people.write':'cloudflare','school.files':'cloudflare',
  'human-resources.core':'cloudflare',
  'finance.reference.read':'cloudflare','finance.documents.write':'cloudflare','finance.payments.write':'cloudflare','finance.journals.write':'cloudflare','finance.reversals.write':'cloudflare',
  'school-fees.read':'cloudflare','school-fees.write':'cloudflare','school-fees.reversal':'cloudflare',
  'payroll.read':'cloudflare','payroll.write':'cloudflare','payroll.reversal':'cloudflare',
  'inventory.read':'cloudflare','inventory.write':'cloudflare',
  'printerly.nodes':'cloudflare','printerly.jobs':'cloudflare','printerly.scanner':'cloudflare','printerly.core':'cloudflare','printerly.governance':'cloudflare','printerly.batch':'cloudflare','printerly.routing':'cloudflare','printerly.release':'cloudflare','printerly.retention':'cloudflare','printerly.supplies':'cloudflare','printerly.procurement':'cloudflare','printerly.service-desk':'cloudflare','printerly.audit':'cloudflare','printerly.alerts':'cloudflare',
  'nvr.metadata':'cloudflare'
});
export const CUTOVER_CAPABILITIES=defaults;
export function createCutoverCapabilities(overrides={}){
  const map={...defaults};
  for(const [name,state] of Object.entries(overrides)){if(!(name in map))throw new TypeError(`Unknown cutover capability: ${name}`);if(!states.has(state))throw new TypeError(`Invalid cutover state: ${state}`);map[name]=state;}
  return Object.freeze({
    all:Object.freeze({...map}),
    state(name){if(!(name in map))throw new TypeError(`Unknown cutover capability: ${name}`);return map[name];},
    isNodeAuthoritative(name){return this.state(name)==='node';},
    shouldShadow(name){return this.state(name)==='shadow';}
  });
}
