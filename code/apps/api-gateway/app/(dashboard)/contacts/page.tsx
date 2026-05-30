'use client'

import { useState } from 'react'
import { useApproveContacts, useContacts, useDeleteContact, useResearchApproveContacts } from '@/lib/hooks'
import { Contact } from '@/lib/api'
import { UploadContactsModal } from '@/components/upload-contacts-modal'
import { AddContactModal } from '@/components/add-contact-modal'
import { LeadScoutCard } from '@/components/lead-scout-card'
import { GoogleSheetImportCard } from '@/components/google-sheet-import-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, CheckCircle2, Search, ShieldCheck, Trash2 } from 'lucide-react'

export default function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { data: contacts, isLoading } = useContacts()
  const { mutate: deleteContact } = useDeleteContact()
  const { mutate: approveContacts, isPending: approving } = useApproveContacts()
  const { mutate: researchApproveContacts, isPending: researching } = useResearchApproveContacts()

  const filteredContacts = contacts
    ?.filter((contact: Contact) => {
      const matchesSearch = 
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || contact.status === statusFilter
      return matchesSearch && matchesStatus
    })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-500'
      case 'replied':
        return 'bg-blue-500/10 text-blue-500'
      case 'bounced':
        return 'bg-red-500/10 text-red-500'
      default:
        return 'bg-gray-500/10 text-gray-500'
    }
  }

  const isApproved = (contact: Contact) => contact.customFields?.send_status === 'approved'
  const hunterVerdict = (contact: Contact) => String(contact.customFields?.hunter_verdict ?? '')
  const hunterConfidence = (contact: Contact) => Number(contact.customFields?.hunter_confidence ?? contact.customFields?.research_score ?? 0)
  const hunterBlockers = (contact: Contact) => {
    const blockers = contact.customFields?.hunter_blockers
    return Array.isArray(blockers) ? blockers.map(String).filter(Boolean) : []
  }
  const getHunterBadge = (contact: Contact) => {
    const verdict = hunterVerdict(contact)
    if (isApproved(contact) || verdict === 'approved') {
      return <Badge className="bg-emerald-500/10 text-emerald-500">verified {hunterConfidence(contact) || ''}</Badge>
    }
    if (verdict === 'blocked' || contact.customFields?.send_status === 'blocked') {
      return <Badge className="bg-red-500/10 text-red-500">blocked {hunterConfidence(contact) || ''}</Badge>
    }
    if (verdict === 'review') {
      return <Badge className="bg-amber-500/10 text-amber-500">review {hunterConfidence(contact) || ''}</Badge>
    }
    return <Badge className="bg-slate-500/10 text-slate-400">unchecked</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Prospects</h1>
          <p className="text-muted-foreground">Import and manage your prospect database</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => researchApproveContacts({})}
            disabled={researching}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {researching ? 'Researching...' : 'Research & Approve Best'}
          </Button>
          <AddContactModal />
          <UploadContactsModal />
        </div>
      </div>

      <LeadScoutCard />

      <GoogleSheetImportCard />

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Prospects ({filteredContacts?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hunter Gate</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead>Added Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <TableRow key={i}>
                        {Array(8)
                          .fill(0)
                          .map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                      </TableRow>
                    ))
                ) : filteredContacts && filteredContacts.length > 0 ? (
                  filteredContacts.map((contact: Contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.email}</TableCell>
                      <TableCell>{contact.name}</TableCell>
                      <TableCell>{contact.company}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(contact.status)}>
                          {contact.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getHunterBadge(contact)}
                          {hunterBlockers(contact).length > 0 ? (
                            <div className="flex max-w-[260px] items-start gap-1 text-xs text-muted-foreground">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate" title={hunterBlockers(contact).join(', ')}>
                                {hunterBlockers(contact).slice(0, 2).join(', ')}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isApproved(contact) ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500">
                            approved
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approveContacts({ ids: [contact.id] })}
                            disabled={approving || contact.status !== 'active'}
                          >
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                            Approve
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        {contact.addedAt.toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteContact(contact.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No contacts found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
