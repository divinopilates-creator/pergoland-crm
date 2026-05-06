"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ContactForm } from "./ContactForm";
import { ActivityForm } from "@/components/activities/ActivityForm";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  FileText,
  Clock,
  Users,
  Pencil,
  Trash2,
  Plus,
  MessageCircle,
  Copy,
  Check,
  Send,
  Paperclip,
} from "lucide-react";
import { formatCurrency, formatDate, formatRelativeDate, cleanPhoneForWhatsApp } from "@/lib/constants";
import { ACTIVITY_TYPE_CONFIG, SOURCE_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import type { Temperature, ActivityType, LeadSource } from "@/types";
import { WhatsAppChat } from "./WhatsAppChat";

const activityIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  note: FileText,
  follow_up: Clock,
};

interface ContactDetailClientProps {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    source: string;
    temperature: string;
    score: number;
    notes: string | null;
    createdAt: number | Date;
  };
  deals: Array<{
    id: string;
    title: string;
    value: number;
    probability: number;
    stageName: string | null;
    stageColor: string | null;
    createdAt: number | Date;
  }>;
  activities: Array<{
    id: string;
    type: string;
    description: string;
    scheduledAt: number | Date | null;
    completedAt: number | Date | null;
    attachmentPath: string | null;
    createdAt: number | Date;
  }>;
}

export function ContactDetailClient({
  contact,
  deals,
  activities,
}: ContactDetailClientProps) {
  const router = useRouter();
  const [showEditForm, setShowEditForm] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"actividades" | "conversacion">("actividades");
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);

  const handleSendEmail = async (activityId: string) => {
    setSendingEmail(activityId);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, activityId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar");
      toast.success(`Cotización enviada a ${data.to}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar email");
    } finally {
      setSendingEmail(null);
    }
  };

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success("Copiado");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("Error al copiar");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Estas seguro de eliminar este contacto? Esta accion no se puede deshacer.")) {
      return;
    }

    try {
      const res = await fetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      toast.success("Contacto eliminado");
      router.push("/contacts");
    } catch {
      toast.error("Error al eliminar el contacto");
    }
  };

  const handleCompleteActivity = async (activityId: string) => {
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("Error");
      toast.success("Actividad completada");
      router.refresh();
    } catch {
      toast.error("Error al completar la actividad");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/contacts")}
          className="cursor-pointer"
          aria-label="Volver a contactos"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{contact.name}</h1>
            <StatusBadge temperature={contact.temperature as Temperature} />
          </div>
          <p className="text-muted-foreground">
            Score: {contact.score}/100 &middot;{" "}
            {SOURCE_LABELS[contact.source as LeadSource] || contact.source}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEditForm(true)}
            className="cursor-pointer"
          >
            <Pencil className="h-4 w-4 mr-1" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            className="cursor-pointer text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Eliminar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informacion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contact.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <a href={`mailto:${contact.email}`} className="text-primary hover:underline flex-1 truncate">
                  {contact.email}
                </a>
                <button
                  onClick={() => handleCopy(contact.email!, "email")}
                  className="p-1 rounded hover:bg-muted cursor-pointer"
                  title="Copiar email"
                >
                  {copiedField === "email" ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1">{contact.phone}</span>
                <div className="flex items-center gap-1">
                  <a
                    href={`https://wa.me/${cleanPhoneForWhatsApp(contact.phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-green-50 cursor-pointer"
                    title="Abrir WhatsApp"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-green-600" />
                  </a>
                  <a
                    href={`tel:${contact.phone}`}
                    className="p-1 rounded hover:bg-blue-50 cursor-pointer"
                    title="Llamar"
                  >
                    <Phone className="h-3.5 w-3.5 text-blue-600" />
                  </a>
                  <button
                    onClick={() => handleCopy(contact.phone!, "phone")}
                    className="p-1 rounded hover:bg-muted cursor-pointer"
                    title="Copiar telefono"
                  >
                    {copiedField === "phone" ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>
            )}
            {contact.company && (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{contact.company}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Creado {formatDate(contact.createdAt)}</span>
            </div>
            {contact.notes && (
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground">{contact.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Deals ({deals.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin deals</p>
            ) : (
              <div className="space-y-3">
                {deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/deals/${deal.id}`)}
                  >
                    <p className="text-sm font-medium">{deal.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-sm font-semibold text-primary">
                        {formatCurrency(deal.value)}
                      </span>
                      <Badge
                        variant="outline"
                        style={{
                          borderColor: deal.stageColor || undefined,
                          color: deal.stageColor || undefined,
                        }}
                      >
                        {deal.stageName}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actividades + Conversación WhatsApp */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveTab("actividades")}
                  className={`px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${activeTab === "actividades" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Actividades ({activities.length})
                </button>
                {contact.phone && (
                  <button
                    onClick={() => setActiveTab("conversacion")}
                    className={`px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors ${activeTab === "conversacion" ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    💬 WhatsApp
                  </button>
                )}
              </div>
              {activeTab === "actividades" && (
                <Button variant="ghost" size="sm" onClick={() => setShowActivityForm(true)} className="cursor-pointer">
                  <Plus className="h-4 w-4 mr-1" />
                  Registrar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {activeTab === "actividades" ? (
              activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin actividades. Registra una llamada, email o nota.</p>
              ) : (
                <div className="space-y-4">
                  {activities.map((activity) => {
                    const Icon = activityIcons[activity.type] || FileText;
                    const config = ACTIVITY_TYPE_CONFIG[activity.type as ActivityType];
                    const isPending = !activity.completedAt && activity.scheduledAt;
                    return (
                      <div key={activity.id} className="flex gap-3">
                        <div className="rounded-full bg-muted p-2 h-fit shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {config?.label || activity.type}
                            </Badge>
                            {isPending && (
                              <Badge variant="outline" className="text-xs text-orange-600 border-orange-600 cursor-pointer" onClick={() => handleCompleteActivity(activity.id)}>
                                Completar
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1">{activity.description}</p>
                          {activity.attachmentPath && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground truncate">{activity.attachmentPath.split("/").pop()}</span>
                              {contact.email && (
                                <button onClick={() => handleSendEmail(activity.id)} disabled={sendingEmail === activity.id} className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 cursor-pointer">
                                  <Send className="h-3 w-3" />
                                  {sendingEmail === activity.id ? "Enviando..." : "Enviar por email"}
                                </button>
                              )}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeDate(activity.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              contact.phone && <WhatsAppChat phone={contact.phone} contactName={contact.name} />
            )}
          </CardContent>
        </Card>
      </div>

      <ContactForm
        open={showEditForm}
        onClose={() => {
          setShowEditForm(false);
          router.refresh();
        }}
        initialData={{
          id: contact.id,
          name: contact.name,
          email: contact.email || "",
          phone: contact.phone || "",
          company: contact.company || "",
          source: contact.source,
          temperature: contact.temperature as "cold" | "warm" | "hot",
          notes: contact.notes || "",
        }}
      />

      <ActivityForm
        open={showActivityForm}
        onClose={() => {
          setShowActivityForm(false);
          router.refresh();
        }}
        preselectedContactId={contact.id}
      />
    </div>
  );
}
