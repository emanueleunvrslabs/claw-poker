'use client'
import { useConnect, useDisconnect, useAccount } from 'wagmi'
import { injected } from 'wagmi/connectors'

export function useMetaMask() {
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { address, isConnected } = useAccount()

  const connectWallet = async () => {
    const eth = (window as any).ethereum
    if (!eth) {
      window.open('https://metamask.io/download/', '_blank')
      return
    }
    try {
      await eth.request({ method: 'eth_requestAccounts' })
    } catch {
      // user rejected — still try wagmi
    }
    connect({ connector: injected() })
  }

  return { connectWallet, disconnect, address, isConnected }
}
