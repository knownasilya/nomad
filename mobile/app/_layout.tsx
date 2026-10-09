import '../lib/log' // installs the [nomad] console prefix — keep first so all later logs are tagged
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useTheme } from '../lib/theme'

export default function RootLayout () {
  const t = useTheme()
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg }
        }}
      >
        <Stack.Screen name='index' />
        {/* The tab grid fades in over the browser, like Chrome's switcher, rather than sliding. */}
        <Stack.Screen name='tabs' options={{ animation: 'fade' }} />
      </Stack>
    </SafeAreaProvider>
  )
}
