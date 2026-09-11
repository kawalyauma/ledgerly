function required(value, name) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`); return value.trim(); }
export class ContactsService {
  constructor({ repository, audit = null }) { if (!repository) throw new TypeError('repository required'); this.repository=repository; this.audit=audit; }
  async create({ organizationId, actor, contact }) {
    required(organizationId,'organizationId'); required(contact?.id,'contact.id'); required(contact?.type,'contact.type'); required(contact?.name,'contact.name');
    const row = await this.repository.create({ organizationId, contact, changedBy: actor?.actorId ?? null });
    if (this.audit) await this.audit.write({ organizationId, actorType: actor?.actorType ?? 'human', actorId: actor?.actorId ?? 'unknown', action:'contacts.create', entityType:'contact', entityId:row.id, after:row });
    return row;
  }
  get(input){ return this.repository.get(input.organizationId,input.id); }
  list(input){ return this.repository.list(input); }
}
