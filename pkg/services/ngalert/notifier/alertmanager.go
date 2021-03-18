package notifier

import (
	"context"
	"path/filepath"
	"sort"
	"sync"
	"time"

	gokit_log "github.com/go-kit/kit/log"
	"github.com/pkg/errors"
	"github.com/prometheus/alertmanager/config"
	"github.com/prometheus/alertmanager/dispatch"
	"github.com/prometheus/alertmanager/nflog"
	"github.com/prometheus/alertmanager/nflog/nflogpb"
	"github.com/prometheus/alertmanager/notify"
	"github.com/prometheus/alertmanager/notify/email"
	"github.com/prometheus/alertmanager/notify/webhook"
	"github.com/prometheus/alertmanager/pkg/labels"
	"github.com/prometheus/alertmanager/silence"
	"github.com/prometheus/alertmanager/silence/silencepb"
	"github.com/prometheus/alertmanager/template"
	"github.com/prometheus/alertmanager/types"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/registry"
	"github.com/grafana/grafana/pkg/services/ngalert/models"
	"github.com/grafana/grafana/pkg/services/ngalert/store"
	"github.com/grafana/grafana/pkg/setting"
)

const (
	workingDir = "alerting"
)

type Alertmanager struct {
	logger   log.Logger
	Store    store.AlertingStore
	Settings *setting.Cfg `inject:""`

	// notificationLog keeps tracks of which notifications we've fired already.
	notificationLog *nflog.Log
	// silences keeps the track of which notifications we should not fire due to user configuration.
	silences        *silence.Silences
	marker          types.Marker
	alerts          *AlertProvider
	dispatcher      *dispatch.Dispatcher
	integrationsMap map[string][]notify.Integration

	wg sync.WaitGroup
}

type WithReceiverStage struct {
}

func (s *WithReceiverStage) Exec(ctx context.Context, l gokit_log.Logger, alerts ...*types.Alert) (context.Context, []*types.Alert, error) {
	//TODO: Alerts with a receiver should be handled here.
	return ctx, nil, nil
}

func init() {
	registry.RegisterService(&Alertmanager{})
}

func (am *Alertmanager) IsDisabled() bool {
	return !setting.AlertingEnabled || !setting.ExecuteAlerts
}

func (am *Alertmanager) Init() error {
	am.logger = log.New("alertmanager")
	am.Store = store.DBstore{} //TODO: Is this right?

	err := am.Setup()
	if err != nil {
		return errors.Wrap(err, "unable to start the Alertmanager")
	}

	return nil
}

// Setup takes care of initializing the various configuration we need to run an Alertmanager.
func (am *Alertmanager) Setup() error {
	// First, let's get the configuration we need from the database and settings.
	q := &models.GetLatestAlertmanagerConfigurationQuery{}
	if err := am.Store.GetLatestAlertmanagerConfiguration(q); err != nil {
		return err
	}

	// Next, let's parse the alertmanager configuration.
	cfg, err := parse(q.Result.AlertmanagerConfiguration, q.Result.AlertmanagerTemplates)
	if err != nil {
		return err
	}

	// With that, we need to make sure we persist the templates to disk.
	paths, _, err := cfg.PersistTemplates(am.WorkingDirPath())
	if err != nil {
		return err
	}

	// With the templates persisted, create the template list using the paths.
	tmpl, err := template.FromGlobs(paths...)
	if err != nil {
		return err
	}

	// Finally, build the integrations map using the receiver configuration and templates.
	am.integrationsMap, err = am.buildIntegrationsMap(cfg.Alertmanager.Receivers, tmpl)
	if err != nil {
		return err
	}

	//TODO: DO I need to set this to the grafana URL?
	//tmpl.ExternalURL = url.URL{}

	return nil
}

func (am *Alertmanager) Run(ctx context.Context) error {
	//TODO: Speak with David Parrot wrt to the marker, we'll probably need our own.
	am.marker = types.NewMarker(prometheus.DefaultRegisterer)

	var err error
	am.alerts, err = NewAlertProvider(&WithReceiverStage{}, am.marker, gokit_log.NewNopLogger())
	if err != nil {
		return errors.Wrap(err, "failed to initialize alerting storage component")
	}

	am.silences, err = silence.New(silence.Options{
		SnapshotFile: filepath.Join("dir", "silences"), //TODO: This is a setting
		Retention:    time.Hour * 24,                   //TODO: This is also a setting
	})
	if err != nil {
		return errors.Wrap(err, "unable to initialize the silencing component of alerting")
	}

	am.notificationLog, err = nflog.New(
		nflog.WithRetention(time.Hour*24),                         //TODO: This is a setting.
		nflog.WithSnapshot(filepath.Join("dir", "notifications")), //TODO: This should be a setting
	)
	if err != nil {
		return errors.Wrap(err, "unable to initialize the notification log component of alerting")
	}

	{
		// Now, let's put together our notification pipeline
		routingStage := make(notify.RoutingStage, len(am.integrationsMap))

		silencingStage := notify.NewMuteStage(silence.NewSilencer(am.silences, am.marker, gokit_log.NewNopLogger()))
		//TODO: We need to unify these receivers
		for name := range am.integrationsMap {
			stage := createReceiverStage(name, am.integrationsMap[name], waitFunc, am.notificationLog)
			routingStage[name] = notify.MultiStage{silencingStage, stage}
		}
		am.dispatcher = dispatch.NewDispatcher(am.alerts, BuildRoutingConfiguration(), routingStage, am.marker, timeoutFunc, gokit_log.NewNopLogger(), nil)
	}

	am.wg.Add(1)
	go am.dispatcher.Run()
	return nil
}

// CreateAlerts receives the alerts and then sends them through the corresponding route based on whenever the alert has a receiver embedded or not
func (am *Alertmanager) CreateAlerts(alerts ...*PostableAlert) error {
	return am.alerts.PutPostableAlert(alerts...)
}

func (am *Alertmanager) ListSilences(matchers []*labels.Matcher) ([]types.Silence, error) {
	pbsilences, _, err := am.silences.Query()
	if err != nil {
		return nil, errors.Wrap(err, "unable to query for the list of silences")
	}
	r := []types.Silence{}
	for _, pbs := range pbsilences {
		s, err := silenceFromProto(pbs)
		if err != nil {
			return nil, errors.Wrap(err, "unable to marshal silence")
		}

		sms := make(map[string]string)
		for _, m := range s.Matchers {
			sms[m.Name] = m.Value
		}

		if !matchFilterLabels(matchers, sms) {
			continue
		}

		r = append(r, *s)
	}

	var active, pending, expired []types.Silence
	for _, s := range r {
		switch s.Status.State {
		case types.SilenceStateActive:
			active = append(active, s)
		case types.SilenceStatePending:
			pending = append(pending, s)
		case types.SilenceStateExpired:
			expired = append(expired, s)
		}
	}

	sort.Slice(active, func(i int, j int) bool {
		return active[i].EndsAt.Before(active[j].EndsAt)
	})
	sort.Slice(pending, func(i int, j int) bool {
		return pending[i].StartsAt.Before(pending[j].EndsAt)
	})
	sort.Slice(expired, func(i int, j int) bool {
		return expired[i].EndsAt.After(expired[j].EndsAt)
	})

	// Initialize silences explicitly to an empty list (instead of nil)
	// So that it does not get converted to "null" in JSON.
	silences := []types.Silence{}
	silences = append(silences, active...)
	silences = append(silences, pending...)
	silences = append(silences, expired...)

	return silences, nil
}

func (am *Alertmanager) GetSilence(silence *types.Silence)    {}
func (am *Alertmanager) CreateSilence(silence *types.Silence) {}
func (am *Alertmanager) DeleteSilence(silence *types.Silence) {}

func (am *Alertmanager) WorkingDirPath() string {
	return filepath.Join(am.Settings.DataPath, workingDir)
}

// buildIntegrationsMap builds a map of name to the list of integration notifiers off of a list of receiver config.
func (am *Alertmanager) buildIntegrationsMap(receivers []*config.Receiver, templates *template.Template) (map[string][]notify.Integration, error) {
	integrationsMap := make(map[string][]notify.Integration, len(receivers))
	for _, receiver := range receivers {
		integrations, err := am.buildReceiverIntegrations(receiver, templates)
		if err != nil {
			return nil, err
		}
		integrationsMap[receiver.Name] = integrations
	}

	return integrationsMap, nil
}

// buildReceiverIntegrations builds a list of integration notifiers off of a receiver config.
func (am *Alertmanager) buildReceiverIntegrations(receiver *config.Receiver, templates *template.Template) ([]notify.Integration, error) {
	var (
		errs         types.MultiError
		integrations []notify.Integration
		add          = func(name string, i int, rs notify.ResolvedSender, f func(l gokit_log.Logger) (notify.Notifier, error)) {
			n, err := f(gokit_log.NewNopLogger())
			if err != nil {
				errs.Add(err)
				return
			}
			integrations = append(integrations, notify.NewIntegration(n, rs, name, i))
		}
	)

	for i, c := range receiver.WebhookConfigs {
		add("webhook", i, c, func(l gokit_log.Logger) (notify.Notifier, error) { return webhook.New(c, templates, l) })
	}

	for i, c := range receiver.EmailConfigs {
		add("email", i, c, func(l gokit_log.Logger) (notify.Notifier, error) { return email.New(c, templates, l), nil })
	}

	if errs.Len() > 0 {
		return nil, &errs
	}
	return integrations, nil
}

// createReceiverStage creates a pipeline of stages for a receiver.
func createReceiverStage(name string, integrations []notify.Integration, wait func() time.Duration, notificationLog notify.NotificationLog) notify.Stage {
	var fs notify.FanoutStage
	for i := range integrations {
		recv := &nflogpb.Receiver{
			GroupName:   name,
			Integration: integrations[i].Name(),
			Idx:         uint32(integrations[i].Index()),
		}
		var s notify.MultiStage
		s = append(s, notify.NewWaitStage(wait))
		s = append(s, notify.NewDedupStage(&integrations[i], notificationLog, recv))
		//TODO: This probably won't work w/o the metrics
		s = append(s, notify.NewRetryStage(integrations[i], name, nil))
		s = append(s, notify.NewSetNotifiesStage(notificationLog, recv))

		fs = append(fs, s)
	}
	return fs
}

// BuildRoutingConfiguration produces an alertmanager-based routing configuration.
func BuildRoutingConfiguration() *dispatch.Route {
	var cfg *config.Config
	return dispatch.NewRoute(cfg.Route, nil)
}

func waitFunc() time.Duration {
	return setting.AlertingNotificationTimeout
}

func timeoutFunc(d time.Duration) time.Duration {
	//TODO: What does MinTimeout means here?
	if d < notify.MinTimeout {
		d = notify.MinTimeout
	}
	return d + waitFunc()
}

// copied from the Alertmanager
func silenceFromProto(s *silencepb.Silence) (*types.Silence, error) {
	sil := &types.Silence{
		ID:        s.Id,
		StartsAt:  s.StartsAt,
		EndsAt:    s.EndsAt,
		UpdatedAt: s.UpdatedAt,
		Status: types.SilenceStatus{
			State: types.CalcSilenceState(s.StartsAt, s.EndsAt),
		},
		Comment:   s.Comment,
		CreatedBy: s.CreatedBy,
	}
	for _, m := range s.Matchers {
		var t labels.MatchType
		switch m.Type {
		case silencepb.Matcher_EQUAL:
			t = labels.MatchEqual
		case silencepb.Matcher_REGEXP:
			t = labels.MatchRegexp
		case silencepb.Matcher_NOT_EQUAL:
			t = labels.MatchNotEqual
		case silencepb.Matcher_NOT_REGEXP:
			t = labels.MatchNotRegexp
		}
		matcher, err := labels.NewMatcher(t, m.Name, m.Pattern)
		if err != nil {
			return nil, err
		}

		sil.Matchers = append(sil.Matchers, matcher)
	}

	return sil, nil
}

func matchFilterLabels(matchers []*labels.Matcher, sms map[string]string) bool {
	for _, m := range matchers {
		v, prs := sms[m.Name]
		switch m.Type {
		case labels.MatchNotRegexp, labels.MatchNotEqual:
			if m.Value == "" && prs {
				continue
			}
			if !m.Matches(v) {
				return false
			}
		default:
			if m.Value == "" && !prs {
				continue
			}
			if !m.Matches(v) {
				return false
			}
		}
	}

	return true
}
