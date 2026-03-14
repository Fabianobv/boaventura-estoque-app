import { Redirect } from "expo-router"

/** Redireciona a rota raiz das abas para Abastecimento */
export default function TabIndex() {
  return <Redirect href="/(tabs)/abastecimento" />
}
