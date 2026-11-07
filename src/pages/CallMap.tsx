import { useEffect, useRef, useState } from 'react'
import { MapPin, Navigation } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase.ts'

type Point = { at: string; lat: number; lng: number; accuracy_m: number | null }

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Where she was during a shared call: trail + latest point, refreshed while the call is live. */
export default function CallMap({ callId, live }: { callId: string; live: boolean }) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const load = () => supabase?.rpc('shared_call_path', { p_call_id: callId }).then(({ data }) => data && setPoints(data))
    load()
    if (!live) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [callId, live])

  useEffect(() => {
    if (!el.current || !points?.length) return
    if (!map.current) {
      map.current = L.map(el.current, { attributionControl: true, zoomControl: false })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(map.current)
      layer.current = L.layerGroup().addTo(map.current)
    }
    const path = points.map((p) => [p.lat, p.lng] as L.LatLngTuple)
    const end = points[points.length - 1]
    layer.current!.clearLayers()
    if (path.length > 1) L.polyline(path, { color: '#1cb0f6', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(layer.current!)
    for (const p of points.slice(0, -1)) {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#1cb0f6', fillOpacity: 1 })
        .bindTooltip(time(p.at)).addTo(layer.current!)
    }
    if (end.accuracy_m) L.circle([end.lat, end.lng], { radius: end.accuracy_m, weight: 0, fillOpacity: 0.15 }).addTo(layer.current!)
    L.circleMarker([end.lat, end.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#ff4b4b', fillOpacity: 1 })
      .bindTooltip(time(end.at)).addTo(layer.current!)
    if (path.length > 1) map.current.fitBounds(L.latLngBounds(path), { padding: [24, 24], maxZoom: 17 })
    else map.current.setView([end.lat, end.lng], 16)
  }, [points])

  useEffect(() => () => void map.current?.remove(), [])

  if (points === null) return null
  if (!points.length) {
    return <p className="text-xs font-semibold text-base-content/50 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> No location shared for this call.</p>
  }
  const end = points[points.length - 1]
  return (
    <div className="space-y-1.5">
      <div ref={el} className="h-56 rounded-box overflow-hidden border-2 border-base-300 z-0" />
      <div className="flex items-center gap-2 text-xs font-semibold text-base-content/70">
        <span className="flex-1">
          {live ? 'Last seen' : 'Last location'} {time(end.at)}
          {end.accuracy_m ? ` · within ${Math.round(end.accuracy_m)} m` : ''}
        </span>
        <a className="btn btn-secondary btn-xs rounded-lg font-extrabold gap-1" target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${end.lat},${end.lng}`}>
          <Navigation className="w-3.5 h-3.5" /> Open in Maps
        </a>
      </div>
    </div>
  )
}
