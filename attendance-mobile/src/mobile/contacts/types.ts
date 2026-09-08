export type ContactCapability={enabledModules:Array<{key:string;name:string;category:string}>;sources:Array<{moduleKey:string;name:string;groups:string[];channels:string[]}>};
export type DirectoryPerson={id:string;entityId:string;contactId?:string|null;sourceModule:string;group:string;name:string;email?:string|null;phone?:string|null;code?:string|null;active:boolean;channels?:string[]};
export type CoreContact={id:string;type:"customer"|"supplier"|"employee"|"other";code?:string|null;name:string;email?:string|null;taxNumber?:string|null;paymentTermsDays:number;active:boolean;creditLimitMinor:number;pricingTier?:string|null;customFields?:Record<string,unknown>;createdAt?:string;archivedAt?:string|null;updatedAt?:string|null};
export type ContactAddress={id:string;type:"billing"|"shipping"|"registered"|"other";line1:string;line2?:string|null;city?:string|null;state?:string|null;postalCode?:string|null;country:string;isDefault:boolean;createdAt?:string;updatedAt?:string};
export type ContactPerson={id:string;name:string;email?:string|null;phone?:string|null;role?:string|null;isPrimary:boolean;createdAt?:string;updatedAt?:string};
export type ContactDetail={contact:CoreContact;addresses:ContactAddress[];people:ContactPerson[]};
export type ArchivedContact={id:string;type:string;code?:string|null;name:string;email?:string|null;archivedAt:string};
