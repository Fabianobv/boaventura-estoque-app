import { Redirect } from "expo-router"

/** Redireciona a rota raiz das abas para Home */
export default function TabIndex() {
  return <Redirect href="/(tabs)/home" />
}
