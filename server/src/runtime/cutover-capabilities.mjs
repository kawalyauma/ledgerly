const states=new Set(['cloudflare','shadow','node']);
const defaults=Object.freeze({
  'auth.login':'cloudflare','auth.register':'cloudflare','organizations.read':'cloudflare','organizations.write':'cloudflare',
  'school.reference.read':'cloudflare','school.reference.write':'cloudflare',
  'finance.reference.read':'cloudflare','finance.documents.write':'cloudflare','finance.payments.write':'cloudflare','finance.journals.write':'cloudflare','finance.reversals.write':'cloudflare',
  'school-fees.read':'cloudflare','school-fees.write':'cloudflare','school-fees.reversal':'cloudflare',
  'payroll.read':'cloudflare','payroll.write':'cloudflare','payroll.reversal':'cloudflare',
  'inventory.read':'cloudflare','inventory.write':'cloudflare',
  'printerly.nodes':'cloudflare','printerly.jobs':'cloudflare','nvr.metadata':'cloudflare'
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
