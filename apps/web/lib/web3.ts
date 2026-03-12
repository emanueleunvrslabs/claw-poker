import { createConfig, http } from 'wagmi'
import { base } from 'viem/chains'
import { injected } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [injected()],
  ssr: true,
})

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
