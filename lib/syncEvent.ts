/**
 * syncEvent — evento global de sincronização
 * Permite que o botão "Sincronizar" do header recarregue qualquer tela ativa.
 */
import { DeviceEventEmitter } from "react-native"

export const SYNC_EVENT = "BOAVENTURA_SYNC"

export function emitSync() {
  DeviceEventEmitter.emit(SYNC_EVENT)
}

export function onSync(callback: () => void) {
  const sub = DeviceEventEmitter.addListener(SYNC_EVENT, callback)
  return () => sub.remove()
}
