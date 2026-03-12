import { LiveTable } from '@/components/table/LiveTable'

export default function TablePopup({ params }: { params: { id: string; n: string } }) {
  return (
    <div style={{
      height: '100vh',
      minWidth: 380,
      display: 'flex',
      padding: '8px',
      boxSizing: 'border-box',
      alignItems: 'flex-start',
      justifyContent: 'center',
      overflow: 'visible',
    }}>
      {/*
        Width is constrained so the table never overflows vertically.
        Formula: available_height = 100vh - 16px (padding) - 50px (LiveTable top bar)
        Then width = available_height * (900 / 700)
        overflow:visible lets side-seat nameplates render outside canvas bounds.
      */}
      <div style={{
        width: 'min(100%, calc((100vh - 66px) * 900 / 700))',
        overflow: 'visible',
      }}>
        <LiveTable tournamentId={params.id} />
      </div>
    </div>
  )
}
