export type AgentRole =
  | "CEO"
  | "COO"
  | "CTO"
  | "CMO"
  | "CFO"
  | "PRODUCT"
  | "DATA"
  | "ENGINEERING";


export type AgentStatus =
  | "ACTIVE"
  | "INACTIVE";


export type AgentDefinition = {

  id: string;

  name: string;

  role: AgentRole;

  description: string;

  status: AgentStatus;

  permissions: string[];

};
