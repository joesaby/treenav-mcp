/**
 * Advanced code fixtures for parser tests.
 *
 * Patterns drawn from real-world large codebases:
 *   - Envoy (C++) — implementation files, ClassName::method, structs
 *   - Kubernetes (Go) — receiver methods, interfaces, controllers
 *   - Django (Python) — class-based views, type annotations, decorators
 *   - ripgrep/tokio (Rust) — traits, structs, pub(crate), lifetimes
 *
 * Each fixture is annotated with what the parser currently handles (✓)
 * and known limitations (✗) to catch regressions without masking gaps.
 */

// ── C++ fixtures (generic.ts, lang="c") ─────────────────────────────

/**
 * Envoy-style .cc implementation file.
 *
 * Exercised patterns:
 *   ✓ #include block grouped into imports
 *   ✓ ClassName::method() implementations at indent 0
 *   ✓ Multiple ClassName::method() in one file
 *   ✓ Destructor (ClassName::~ClassName)
 *   ✓ Template method instantiations via explicit ClassName:: prefix
 *
 * Known limitations:
 *   ✗ Classes/functions inside namespace { } blocks (indented → skipped)
 */
export const CPP_ENVOY_FILTER_IMPL = `#include "source/common/http/filter_manager.h"
#include "source/common/common/assert.h"
#include "source/common/common/logger.h"
#include "envoy/http/filter.h"

FilterManagerImpl::FilterManagerImpl(FilterManagerCallbacks& callbacks,
                                     const RequestHeaderMap& request_headers)
    : callbacks_(callbacks), request_headers_(request_headers) {}

FilterManagerImpl::~FilterManagerImpl() {
  ASSERT(state_.destroyed_);
}

void FilterManagerImpl::decodeHeaders(RequestHeaderMap& headers, bool end_stream) {
  state_.remote_complete_ = end_stream;
  for (auto& entry : decode_filter_chain_) {
    if (entry->filter_->decodeHeaders(headers, end_stream) == FilterHeadersStatus::StopIteration) {
      return;
    }
  }
}

bool FilterManagerImpl::createFilterChain() {
  if (state_.created_filter_chain_) {
    return false;
  }
  state_.created_filter_chain_ = true;
  callbacks_.filterFactory().createFilterChain(*this);
  return true;
}

Http::FilterHeadersStatus FilterManagerImpl::encode1xxHeaders(ResponseHeaderMap& headers) {
  for (auto& entry : encode_filter_chain_) {
    entry->filter_->encode1xxHeaders(headers);
  }
  return FilterHeadersStatus::Continue;
}

void FilterManagerImpl::onDestroy() {
  state_.destroyed_ = true;
  for (auto& entry : decode_filter_chain_) {
    entry->filter_->onDestroy();
  }
}
`;

/**
 * Envoy-style .h header file.
 *
 * Exercised patterns:
 *   ✓ Top-level struct declaration
 *   ✓ Top-level class declaration (not inside a namespace)
 *   ✓ Member methods via parseGenericMembers
 *
 * Known limitations:
 *   ✗ Classes declared inside namespace {} are indented and skipped
 */
export const CPP_ENVOY_HEADER = `#pragma once

#include <string>
#include <vector>
#include <memory>

struct FilterState {
  bool remote_complete_ = false;
  bool created_filter_chain_ = false;
  bool destroyed_ = false;
};

class FilterManagerImpl {
public:
  explicit FilterManagerImpl(FilterManagerCallbacks& callbacks,
                             const RequestHeaderMap& request_headers);
  ~FilterManagerImpl();

  void decodeHeaders(RequestHeaderMap& headers, bool end_stream);
  bool createFilterChain();
  Http::FilterHeadersStatus encode1xxHeaders(ResponseHeaderMap& headers);
  void onDestroy();

private:
  FilterManagerCallbacks& callbacks_;
  const RequestHeaderMap& request_headers_;
  FilterState state_;
  std::vector<ActiveFilterPtr> decode_filter_chain_;
  std::vector<ActiveFilterPtr> encode_filter_chain_;
};
`;

// ── Go fixtures (generic.ts, lang="go") ──────────────────────────────

/**
 * Kubernetes-style controller.
 *
 * Exercised patterns:
 *   ✓ Grouped import block (import ( ... ))
 *   ✓ type Foo struct → class
 *   ✓ type Foo interface → interface
 *   ✓ func NewFoo(...) → top-level function
 *   ✓ func (c *Controller) Method(...) → receiver method captured as function
 *   ✓ var ErrFoo = ... → variable
 *   ✓ Go export convention: uppercase name = exported
 */
export const GO_K8S_CONTROLLER = `package controller

import (
	"context"
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

var ErrSyncTimeout = fmt.Errorf("timed out waiting for caches to sync")

type DeploymentController struct {
	client   kubernetes.Interface
	queue    workqueue.RateLimitingInterface
	lister   appslisters.DeploymentLister
	synced   cache.InformerSynced
}

type DeploymentInterface interface {
	List(opts metav1.ListOptions) (*appsv1.DeploymentList, error)
	Get(name string) (*appsv1.Deployment, error)
	Create(ctx context.Context, d *appsv1.Deployment) (*appsv1.Deployment, error)
	Update(ctx context.Context, d *appsv1.Deployment) (*appsv1.Deployment, error)
	Delete(ctx context.Context, name string) error
}

func NewDeploymentController(client kubernetes.Interface, informer cache.SharedIndexInformer) *DeploymentController {
	c := &DeploymentController{
		client: client,
		queue:  workqueue.NewRateLimitingQueue(workqueue.DefaultControllerRateLimiter()),
	}
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    c.enqueue,
		UpdateFunc: func(_, cur interface{}) { c.enqueue(cur) },
	})
	return c
}

func (c *DeploymentController) Run(ctx context.Context, workers int) error {
	defer c.queue.ShutDown()
	if !cache.WaitForCacheSync(ctx.Done(), c.synced) {
		return ErrSyncTimeout
	}
	for i := 0; i < workers; i++ {
		go wait.Until(c.runWorker, time.Second, ctx.Done())
	}
	<-ctx.Done()
	return nil
}

func (c *DeploymentController) syncDeployment(ctx context.Context, key string) (bool, error) {
	deployment, err := c.lister.Get(key)
	if err != nil {
		return false, err
	}
	return true, c.reconcile(ctx, deployment)
}

func (c *DeploymentController) enqueue(obj interface{}) {
	key, err := cache.MetaNamespaceKeyFunc(obj)
	if err != nil {
		return
	}
	c.queue.Add(key)
}

func (c *DeploymentController) runWorker() {
	for c.processNextItem() {
	}
}
`;

// ── Python fixtures (python.ts) ──────────────────────────────────────

/**
 * Django-style class-based views.
 *
 * Exercised patterns:
 *   ✓ Multiple-inheritance class (LoginRequiredMixin, ListView)
 *   ✓ Methods with PEP-484 type annotations (get_queryset → QuerySet)
 *   ✓ @classmethod and @staticmethod decorators in signature
 *   ✓ Module-level constants (CACHE_TTL)
 *   ✓ Standalone function with keyword-only args (dry_run: bool = False)
 *   ✓ Private methods (_build_filter_kwargs)
 *   ✓ Abstract class detection via ABC inheritance
 */
export const PY_DJANGO_VIEWS = `import logging
from typing import Optional, Any
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import ListView, DetailView, CreateView
from django.db.models import QuerySet
from django.http import HttpRequest, HttpResponse

logger = logging.getLogger(__name__)

CACHE_TTL = 300
DEFAULT_PAGE_SIZE = 25


class UserListView(LoginRequiredMixin, ListView):
    model = User
    template_name = "users/list.html"
    paginate_by = DEFAULT_PAGE_SIZE

    def get_queryset(self) -> QuerySet:
        qs = super().get_queryset().select_related("profile")
        search = self.request.GET.get("q", "")
        if search:
            qs = qs.filter(username__icontains=search)
        return qs

    def get_context_data(self, **kwargs: Any) -> dict:
        context = super().get_context_data(**kwargs)
        context["search_query"] = self.request.GET.get("q", "")
        return context


class UserDetailView(LoginRequiredMixin, DetailView):
    model = User
    template_name = "users/detail.html"

    def get_object(self, queryset: Optional[QuerySet] = None) -> User:
        return get_object_or_404(User, pk=self.kwargs["pk"])

    @classmethod
    def get_extra_actions(cls) -> list:
        return []

    @staticmethod
    def format_display_name(user: User) -> str:
        return f"{user.first_name} {user.last_name}".strip() or user.username


class BaseAuditView(LoginRequiredMixin):

    def dispatch(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        logger.info("Audit: %s %s by %s", request.method, request.path, request.user)
        return super().dispatch(request, *args, **kwargs)

    def _build_filter_kwargs(self, params: dict) -> dict:
        return {k: v for k, v in params.items() if v}


def process_user_bulk(user_ids: list[int], *, dry_run: bool = False) -> dict:
    results: dict = {"processed": 0, "errors": []}
    for uid in user_ids:
        try:
            user = User.objects.get(pk=uid)
            if not dry_run:
                user.save()
            results["processed"] += 1
        except User.DoesNotExist as e:
            results["errors"].append(str(e))
    return results
`;

// ── Rust fixtures (generic.ts, lang="rust") ──────────────────────────

/**
 * ripgrep-style matcher trait + implementation.
 *
 * Exercised patterns:
 *   ✓ pub struct → class
 *   ✓ pub trait → interface
 *   ✓ pub fn at top level → function
 *   ✓ pub enum → enum
 *   ✓ pub const / pub static → variable
 *   ✓ Export: pub = exported, no pub = not exported
 *
 * Known limitations:
 *   ✗ impl Trait for Type { } blocks not parsed (no keyword match)
 *   ✗ Methods inside impl blocks (indented) are skipped
 *   ✗ pub(crate) fn not matched (regex expects "pub " with space)
 *   ✗ Lifetime parameters in function signatures (&'a self) not handled
 */
export const RUST_MATCHER = `use std::sync::{Arc, Mutex};
use std::fmt;
use grep_regex::RegexMatcher as Inner;

pub const MAX_PATTERN_LEN: usize = 4096;
pub static DEFAULT_FLAGS: u32 = 0;

pub enum MatchKind {
    All,
    LeftmostFirst,
    LeftmostLongest,
}

pub struct Match {
    pub start: usize,
    pub end: usize,
}

pub struct RegexMatcher {
    pattern: String,
    inner: Arc<Mutex<Inner>>,
    kind: MatchKind,
}

pub trait Matcher: Send + Sync {
    fn is_match(&self, subject: &[u8]) -> bool;
    fn find(&self, haystack: &[u8]) -> Option<Match>;
    fn find_iter(&self, haystack: &[u8], f: impl FnMut(Match) -> bool);
    fn shortest_match(&self, haystack: &[u8]) -> Option<usize>;
}

pub fn new_regex_matcher(pattern: &str) -> Result<RegexMatcher, fmt::Error> {
    let inner = Inner::new(pattern).map_err(|_| fmt::Error)?;
    Ok(RegexMatcher {
        pattern: pattern.to_string(),
        inner: Arc::new(Mutex::new(inner)),
        kind: MatchKind::LeftmostFirst,
    })
}

pub fn build_matchers(patterns: &[String]) -> Result<Vec<RegexMatcher>, fmt::Error> {
    patterns.iter().map(|p| new_regex_matcher(p)).collect()
}

fn internal_normalize(pattern: &str) -> String {
    pattern.trim().to_lowercase()
}

impl RegexMatcher {
    pub fn new(pattern: &str) -> Result<Self, fmt::Error> {
        new_regex_matcher(pattern)
    }

    pub fn pattern(&self) -> &str {
        &self.pattern
    }
}

impl Matcher for RegexMatcher {
    fn is_match(&self, subject: &[u8]) -> bool {
        self.inner.lock().unwrap().is_match(subject).unwrap_or(false)
    }

    fn find(&self, haystack: &[u8]) -> Option<Match> {
        self.inner.lock().unwrap().find(haystack).ok().flatten()
            .map(|m| Match { start: m.start(), end: m.end() })
    }

    fn find_iter(&self, haystack: &[u8], mut f: impl FnMut(Match) -> bool) {
        let re = self.inner.lock().unwrap();
        for m in re.find_iter(haystack) {
            if let Ok(m) = m {
                if !f(Match { start: m.start(), end: m.end() }) { break; }
            }
        }
    }

    fn shortest_match(&self, haystack: &[u8]) -> Option<usize> {
        self.inner.lock().unwrap().shortest_match(haystack).ok().flatten()
    }
}
`;
