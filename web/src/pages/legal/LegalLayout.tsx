import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { company } from '../../config'

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="font-semibold text-slate-900">
            {company.productName}
          </Link>
          <nav className="flex gap-4 text-sm text-slate-500">
            <Link to="/privacidade" className="hover:text-slate-900">Privacidade</Link>
            <Link to="/termos" className="hover:text-slate-900">Termos</Link>
            <Link to="/exclusao-de-dados" className="hover:text-slate-900">Exclusão de dados</Link>
          </nav>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">Última atualização: {company.lastUpdated}</p>
        {children}
        <hr className="my-10 border-slate-200" />
        <p className="text-sm text-slate-500">
          {company.legalName} · CNPJ {company.cnpj} · {company.address} · {company.contactEmail}
        </p>
      </article>
    </div>
  )
}
