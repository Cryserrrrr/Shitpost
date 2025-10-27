import { Socket } from "socket.io";
import { ClientInfo, ClientPresence } from "../types";

export class ClientManager {
  private clients: Map<string, ClientInfo> = new Map();
  private clientsByMachineId: Map<string, ClientInfo[]> = new Map();

  addClient(socket: Socket, machineId: string, name?: string): void {
    const clientInfo: ClientInfo = {
      id: socket.id,
      machineId,
      socket,
      connectedAt: new Date(),
      name: name || machineId,
    };

    this.clients.set(socket.id, clientInfo);
    this.addToMachineIdGroup(clientInfo);
    this.broadcastPresenceUpdate(clientInfo);
  }

  private addToMachineIdGroup(clientInfo: ClientInfo): void {
    if (!this.clientsByMachineId.has(clientInfo.machineId)) {
      this.clientsByMachineId.set(clientInfo.machineId, []);
    }
    this.clientsByMachineId.get(clientInfo.machineId)!.push(clientInfo);
  }

  removeClient(socketId: string): void {
    const client = this.findClientBySocketId(socketId);
    if (client) {
      this.clients.delete(socketId);
      this.removeFromMachineIdGroup(client);
      this.broadcastPresenceList();
    }
  }

  private removeFromMachineIdGroup(client: ClientInfo): void {
    const machineClients = this.clientsByMachineId.get(client.machineId);
    if (machineClients) {
      const index = machineClients.findIndex((c) => c.id === client.id);
      if (index !== -1) {
        machineClients.splice(index, 1);
        if (machineClients.length === 0) {
          this.clientsByMachineId.delete(client.machineId);
        }
      }
    }
  }

  updateClientName(machineId: string, name: string): void {
    const client = this.getClientByMachineId(machineId);
    if (client) {
      client.name = name;
      this.broadcastPresenceUpdate(client);
    }
  }

  findClientBySocketId(socketId: string): ClientInfo | undefined {
    return this.clients.get(socketId);
  }

  getClientByMachineId(machineId: string): ClientInfo | undefined {
    const clients = this.clientsByMachineId.get(machineId);
    return clients && clients.length > 0 ? clients[0] : undefined;
  }

  getClientsByMachineId(machineId: string): ClientInfo[] {
    return this.clientsByMachineId.get(machineId) || [];
  }

  getConnectedClients(): ClientInfo[] {
    return Array.from(this.clients.values());
  }

  getConnectedMachineIds(): string[] {
    return Array.from(this.clientsByMachineId.keys());
  }

  getPresenceList(): ClientPresence[] {
    return Array.from(this.clients.values()).map((client) => ({
      id: client.machineId,
      name: client.name || client.machineId,
    }));
  }

  broadcastToTargets(targetIds: string[], event: string, data: any): void {
    console.log(
      `Broadcasting ${event} to ${targetIds.length} targets:`,
      targetIds
    );

    targetIds.forEach((machineId) => {
      const client = this.getClientByMachineId(machineId);
      if (client) {
        console.log(
          `Sending ${event} to client ${machineId} (socket: ${client.id})`
        );
        client.socket.emit(event, data);
      } else {
        console.log(`Client not found for machineId: ${machineId}`);
      }
    });
  }

  broadcastToAll(event: string, data: any): void {
    this.clients.forEach((client) => {
      client.socket.emit(event, data);
    });
  }

  broadcastPresenceList(): void {
    const presenceList = this.getPresenceList();
    this.broadcastToAll("presence:list", presenceList);
  }

  broadcastPresenceUpdate(client: ClientInfo): void {
    const presenceUpdate: ClientPresence = {
      id: client.machineId,
      name: client.name || client.machineId,
    };
    this.broadcastToAll("presence:update", presenceUpdate);
  }

  getClientCount(): number {
    return this.clientsByMachineId.size;
  }
}
